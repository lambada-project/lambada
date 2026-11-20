---
title: Queues
sidebar_label: Queues (SQS)
slug: /queues
description: Declare SQS queues, send to them by name, and process them with batch handlers and event filters.
---

A queue is declared under `queues` by the name grants and handlers use. Senders are granted it like any resource. Handlers are declared under `queueHandlerDefinitions`, and Lambda polls the queue for them.

```ts
run('shop', environment, {
    environmentVariables: { MAIL_API_KEY: mailApiKey },
    queues: {
        emails: {
            name: 'emails',
            envKeyName: 'EMAILS_QUEUE',
            options: { visibilityTimeoutSeconds: 180 },
        },
    },
    api: {
        endpointDefinitions: [{
            name: 'signUp', path: '/users', method: 'POST', callbackDefinition: signUp,
            resources: { queue: { emails: ['sqs:SendMessage'] } },   // EMAILS_QUEUE = the queue URL
        }],
    },
    queueHandlerDefinitions: [{
        name: 'sendEmail',
        queue: 'emails',
        callback: sendEmail,
        resources: { envVar: ['MAIL_API_KEY'] },
        lambdaOptions: { timeout: 60 },
    }],
})
```

## Declaring a queue

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The queue is named `<name>-<environment>`, with `.fifo` appended for a FIFO queue. |
| `envKeyName` | yes | The variable a granted function reads the queue **URL** from. |
| `options` | | Any Pulumi `aws.sqs.QueueArgs`: `fifoQueue`, `contentBasedDeduplication`, `visibilityTimeoutSeconds`, `delaySeconds`, `messageRetentionSeconds`, `redrivePolicy`… |

```ts
queues: {
    payments: {
        name: 'payments',
        envKeyName: 'PAYMENTS_QUEUE',
        options: { fifoQueue: true, contentBasedDeduplication: true },   // payments-dev.fifo
    },
}
```

:::caution Visibility timeout
SQS hides a received message for the queue's visibility timeout, 30 seconds by default, and AWS refuses to map a queue to a function whose timeout is longer than that. lambada's default function timeout is 90 seconds. Raise `visibilityTimeoutSeconds` to at least the handler's timeout (AWS recommends six times it), or lower the handler's `timeout`.
:::

### Dead-letter queues

There is no dedicated field. Set the queue's `redrivePolicy` to a queue you declare, or to one from another stack:

```ts
queues: {
    emails: {
        name: 'emails', envKeyName: 'EMAILS_QUEUE',
        options: {
            visibilityTimeoutSeconds: 180,
            redrivePolicy: emailsDlq.arn.apply(arn => JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 5 })),
        },
    },
}
```

Here `emailsDlq` is an `aws.sqs.Queue` you create next to `run()`.

### Queues of another stack

`queuesRef` takes another stack's `run().queues`, or definitions looked up as `<name>-<environment>`. A referenced queue is granted and handled exactly like one the stack created.

## Sending

```ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import type { EmbroideryCallback } from '@lambada/core'

let client: SQSClient | undefined
const sqs = () => client ??= new SQSClient({})

export const signUp: EmbroideryCallback = async ({ request }) => {
    const { userId } = JSON.parse(request.body ?? '{}')
    await sqs().send(new SendMessageCommand({
        QueueUrl: process.env.EMAILS_QUEUE,
        MessageBody: JSON.stringify({ type: 'welcome', userId }),
    }))
    return { statusCode: 202, body: { userId } }
}
```

The client is created on first use, inside Lambda, because Pulumi can't serialize one built at deploy time. See [what a handler captures](functions#what-a-handler-captures).

## Handling

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Names the function, its role and the event source mapping. |
| `queue` | yes | A key of `queues` or `queuesRef`. |
| `callback` | yes | `async (event, context) => void \| QueueBatchResponse`, or a [bundle folder](bundles). |
| `resources` | yes | What the function is [granted](permissions). `{}` for nothing. |
| `subscriptionArgs` | | `{ batchSize, maximumBatchingWindowInSeconds }`. |
| `reportBatchItemFailures` | | Let the handler fail single messages instead of the whole batch. |
| `maximumConcurrency` | | Caps how many concurrent invocations the queue drives (2–1000). |
| `filter` | | An event filter: see below. |
| `lambdaOptions`, `environmentVariables`, `policyStatements` | | See [Function options](functions) and [Permissions](permissions). |

The handler is granted `sqs:ReceiveMessage`, `sqs:DeleteMessage` and `sqs:GetQueueAttributes` on its queue. It isn't given the queue's URL: grant the queue under `resources` if it sends to it too.

### Partial batch failures

With `reportBatchItemFailures`, a handler returns the ids of the messages it couldn't process. Only those return to the queue, and the rest are deleted:

```ts
import type { QueueHandlerCallback } from '@lambada/core'

export const sendEmail: QueueHandlerCallback = async (event) => {
    const batchItemFailures: { itemIdentifier: string }[] = []
    for (const record of event.Records) {
        try {
            await deliver(JSON.parse(record.body))
        } catch {
            batchItemFailures.push({ itemIdentifier: record.messageId })
        }
    }
    return { batchItemFailures }
}
```

Without it, a thrown error returns the whole batch to the queue.

## Filtering

A `filter` is a Lambda event filter: messages that don't match are deleted without invoking the function.

```ts
filter: { body: { type: ['welcome', 'receipt'] } }                  // JSON body
filter: { body: [{ prefix: 'ERROR' }] }                             // text body, matched as one string
filter: { messageAttributes: { kind: { stringValue: ['urgent'] } } }
filter: { $or: [{ body: { type: ['refund'] } }, { messageAttributes: { kind: { stringValue: ['urgent'] } } }] }
```

The body takes the same conditions as an [SNS body filter](topics#filtering). Message attributes are compared as strings, so they take string conditions only. A pattern longer than 2,048 characters is refused.

:::warning Filtered messages are deleted
A message that doesn't match the filter is removed from the queue. Use a filter to drop noise, not to share one queue between handlers.
:::
