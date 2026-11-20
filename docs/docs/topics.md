---
title: Topics and subscriptions
sidebar_label: Topics (SNS)
slug: /topics
description: Declare SNS topics, publish to them by name, and subscribe functions with typed filter policies.
---

A topic is declared under `messages` by the name grants and subscriptions use. Publishers are granted it like any resource. Subscribers are declared under `messageHandlerDefinitions`, optionally with a filter that SNS applies before invoking them.

```ts
run('shop', environment, {
    tables: {
        orders: { name: 'orders', primaryKey: 'id', envKeyName: 'ORDERS_TABLE' },
    },
    messages: {
        orderPlaced: { name: 'order-placed', envKeyName: 'ORDER_PLACED_TOPIC' },
    },
    api: {
        endpointDefinitions: [{
            name: 'placeOrder', path: '/orders', method: 'POST', callbackDefinition: placeOrder,
            resources: { topic: { orderPlaced: ['sns:Publish'] } },   // ORDER_PLACED_TOPIC = the topic ARN
        }],
    },
    messageHandlerDefinitions: [{
        name: 'sendReceipt',
        topic: 'orderPlaced',
        callback: sendReceipt,
        resources: { table: { orders: ['dynamodb:GetItem'] } },
    }],
})
```

## Declaring a topic

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The topic is named `<name>-<environment>`. |
| `envKeyName` | yes | The variable a granted function reads the topic ARN from. |
| `encryptionKeyName` | | A key from `keys` or `keysRef` to encrypt the topic with. Left out, the topic is not encrypted. |
| `options` | | Any Pulumi `aws.sns.TopicArgs`, merged under what lambada sets. |
| `deliveryPolicy` | | SNS delivery retry policy for HTTP/S subscriptions. |

Topics are standard topics. FIFO topics are not supported.

### Topics of another stack

`messagesRef` takes topics another stack created: a definition, which is looked up as `<name>-<environment>`, or, within the same Pulumi program, another `run()`'s `messaging`:

```ts
run('billing', environment, {
    messagesRef: {
        orderPlaced: { name: 'order-placed', envKeyName: 'ORDER_PLACED_TOPIC' },
    },
    messageHandlerDefinitions: [{ name: 'invoice', topic: 'orderPlaced', callback: invoice, resources: {} }],
})
```

A referenced topic is granted and subscribed exactly like one the stack created. A key can't be in both `messages` and `messagesRef`.

## Publishing

A function granted `sns:Publish` reads the ARN from its `envKeyName`:

```ts
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import type { EmbroideryCallback } from '@lambada/core'

let client: SNSClient | undefined
const sns = () => client ??= new SNSClient({})   // created inside Lambda: see Function options

export const placeOrder: EmbroideryCallback = async ({ request }) => {
    const order = JSON.parse(request.body ?? '{}')
    await sns().send(new PublishCommand({
        TopicArn: process.env.ORDER_PLACED_TOPIC,
        Message: JSON.stringify(order),
        MessageAttributes: { channel: { DataType: 'String', StringValue: 'web' } },
    }))
    return { statusCode: 202, body: { id: order.id } }
}
```

:::caution Encrypted topics
A publisher to a topic with `encryptionKeyName` also needs the key: grant `kmsKey: { <key>: ['kms:GenerateDataKey', 'kms:Decrypt'] }`. Only tables add their key automatically.
:::

## Subscribing a function

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Names the function, its role and the subscription. |
| `topic` | yes | A key of `messages` or `messagesRef`. |
| `callback` | yes | `async (event, context) => void`, or a [bundle folder](bundles). |
| `resources` | yes | What the function is [granted](permissions). `{}` for nothing. |
| `filter` | | A filter policy: see below. |
| `subscriptionArgs` | | Pulumi's `TopicEventSubscriptionArgs`, such as `redrivePolicy`. Filter with `filter`, not `filterPolicy`. |
| `onFailure`, `retries`, `maximumEventAge` | | What happens when the function fails: see [Failures](#failures). |
| `lambdaOptions`, `environmentVariables`, `policyStatements` | | See [Function options](functions) and [Permissions](permissions). |

The callback receives SNS's event, one record per message:

```ts
import type { SubscriptionCallback } from '@lambada/core'

export const sendReceipt: SubscriptionCallback = async (event) => {
    for (const record of event.Records) {
        const order = JSON.parse(record.Sns.Message)
        // ...
    }
}
```

The subscriber isn't granted the topic it listens to, and doesn't get its ARN. Grant it under `resources` if it publishes back.

## Filtering

A `filter` holds a filter policy on exactly one scope: `attributes` matches the message attributes, `body` matches the JSON body.

```ts
messageHandlerDefinitions: [{
    name: 'flagLargeOrder',
    topic: 'orderPlaced',
    callback: flagLargeOrder,
    resources: {},
    filter: {
        attributes: {
            channel: ['web', { prefix: 'mobile-' }],
            total: [{ numeric: ['>=', 100] }],
        },
    },
}]
```

```ts
filter: {
    body: {
        order: { status: ['paid'] },
        $or: [
            { region: ['eu'] },
            { amount: [{ numeric: ['>', 0, '<=', 500] }] },
        ],
    },
}
```

A condition is a value, or an object with exactly one operator:

| Operator | Example |
| --- | --- |
| exact value | `'paid'`, `42`, `true`, `null` |
| `prefix`, `suffix` | `{ prefix: 'mobile-' }`, `{ suffix: { 'equals-ignore-case': '.PNG' } }` |
| `wildcard` | `{ wildcard: 'order-*-eu' }` |
| `equals-ignore-case` | `{ 'equals-ignore-case': 'Web' }` |
| `anything-but` | `{ 'anything-but': ['test', 'staging'] }`, `{ 'anything-but': { prefix: 'internal-' } }` |
| `numeric` | `{ numeric: ['=', 0] }`, `{ numeric: ['>', 0, '<=', 500] }` |
| `exists` | `{ exists: false }` |
| `cidr` | `{ cidr: '10.0.0.0/24' }` |

The policy types are exported (`AttributePolicy`, `BodyPolicy`, `Condition`) and they follow what AWS accepts. They were built by submitting policies to SNS and Lambda and recording the verdicts. What AWS rejects is a type error, and what it accepts compiles. The few rejected policies a type can't express are refused when the stack is built, naming the function:

- an empty policy, `$or` with one branch, or a numeric range whose bottom isn't below its top;
- an invalid CIDR, or `**` in a wildcard;
- more than SNS allows: 5 keys, 150 combinations, a wildcard complexity of 100, or 3 wildcards in one pattern.

## Failures

SNS invokes a subscriber asynchronously. Lambda retries a failed invocation twice, then drops the event, unless you say otherwise:

```ts
{
    name: 'sendReceipt', topic: 'orderPlaced', callback: sendReceipt, resources: {},
    retries: 1,                              // 0, 1 or 2
    maximumEventAge: { hours: 1 },           // { minutes: 1–360 } or { hours: 1–6 }
    onFailure: { queue: 'failedReceipts' },  // or { topic: '...' }: a key of the stack
}
```

The function is granted `sqs:SendMessage` or `sns:Publish` on its destination automatically. Destinations are standard queues and topics, not FIFO ones.
