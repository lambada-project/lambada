---
title: Core concepts
sidebar_label: Core concepts
slug: /concepts
description: The few ideas the rest of lambada is built on — one run() call, names, grants, environments and references.
---

A lambada stack is one Pulumi program that calls `run()` once. Everything else on this site is a field of that call.

## One call describes the stack

```ts title="index.ts"
import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'

const result = run('shop', pulumi.getStack(), {
    tables:   { /* DynamoDB tables */ },
    buckets:  { /* S3 buckets */ },
    messages: { /* SNS topics */ },
    queues:   { /* SQS queues */ },
    keys:     { /* KMS keys */ },
    secrets:  { /* Secrets Manager secrets */ },
    pools:    { /* Cognito user pools */ },

    api:                      { endpointDefinitions: [ /* HTTP endpoints */ ] },
    messageHandlerDefinitions: [ /* functions subscribed to topics */ ],
    queueHandlerDefinitions:   [ /* functions polling queues */ ],
    scheduleDefinitions:       [ /* functions on a timer */ ],
})

export const apiUrl = result.api?.url
```

`run(projectName, environment, args)`:

1. creates the **resources**: tables, buckets, topics, queues, keys, secrets, pools;
2. checks every name the **functions** refer to, and stops with a list of every mistake if any is wrong, before a function is built;
3. builds each function with a role that can reach exactly what it was granted;
4. builds the API, the CDN and the resource group, and returns what it created.

There are two kinds of entries: **resources**, which hold data or messages, and **functions**, which run code. Functions reach resources only through grants.

## Projects and environments

`projectName` names the stack, and `environment` names one deployment of it: `dev`, `staging`, `prod`. Use the Pulumi stack name for the environment, so `pulumi up --stack prod` deploys `prod`:

```ts
run('shop', pulumi.getStack(), { ... })
```

Most resources are named `<name>-<environment>`, so environments can share an AWS account without clashing: the table `orders` becomes `orders-dev` and `orders-prod`. Tables, buckets, topics and most functions are tagged `Lambada:Project` and `Lambada:Environment`, and a resource group named `<project>-<environment>` collects what carries those tags in the AWS console. Queues, keys, secrets, roles and the API aren't tagged that way yet. Set `resourceGroups: { skipCreate: true }` to skip the group.

## Everything has a name

Each resource is declared under a **key**, the name the rest of the stack uses for it. A function **grants** a resource by that key, listing the IAM actions it needs:

```ts
run('shop', environment, {
    tables: {
        orders: { name: 'orders', primaryKey: 'id', envKeyName: 'ORDERS_TABLE' },
    //  ^ key     ^ physical name, + environment       ^ variable granted functions read
    },
    api: {
        endpointDefinitions: [{
            name: 'getOrder', path: '/orders/{id}', method: 'GET', callbackDefinition: getOrder,
            resources: { table: { orders: ['dynamodb:GetItem'] } },
        }],
    },
})
```

A grant does two things:

- it writes the IAM statement, so `getOrder` may call `GetItem` on `orders-<environment>` and nothing else;
- it sets the resource's `envKeyName` in the function's environment, so the handler reads `process.env.ORDERS_TABLE` instead of a hard-coded name.

A function that grants nothing gets only permission to write logs and the stack's global variables. [Permissions and environment](permissions) has the details for each kind.

## Checked before any function is built

`run()` resolves every name before it builds a single function. A misspelled table, a topic the stack doesn't have or an unknown authorizer fails `pulumi preview`, with every problem listed at once:

```text
Lambada found 2 resources that are granted but absent from the stack:

  getOrder      table 'order' — the stack has: orders, customers
  sendReceipt   topic 'orderPlacd' — the stack has: orderPlaced

Correct the names, or add the resources to run().
```

[Filters](topics#filtering) and [schedules](schedules) take the same idea further. A filter policy or a cron that AWS would reject doesn't compile, and the few a type can't express are refused before deployment.

## Plain declarations and creators

A declaration is normally a plain object, as above. It can also be a **creator**: a function that receives the stack's built resources and returns the declaration.

```ts
endpointDefinitions: [
    // plain declaration: checked before any function is built
    { name: 'getOrder', path: '/orders/{id}', method: 'GET', callbackDefinition: getOrder,
      resources: { table: { orders: ['dynamodb:GetItem'] } } },

    // creator: runs while the stack is built
    (context) => ({
        name: 'health', path: '/health', method: 'GET',
        callbackDefinition: async () => ({ ok: true, environment: context.environment }),
    }),
]
```

Creators are how older stacks reached resources, with `context.databases.orders` and the like. Prefer plain objects: the stack can check them up front, while a creator's mistakes surface only when it runs, one at a time. An endpoint creator that returns `undefined` declares nothing, which makes it handy for an endpoint that only some environments have.

## Stacks that share resources

Each kind has a `…Ref` twin that takes resources the stack doesn't create: `tablesRef`, `bucketsRef`, `messagesRef`, `queuesRef`, `keysRef`, `secretsRef`, `poolsRef`, `customRef` and `apisRef`. A referenced resource is granted, subscribed to and published exactly like one the stack owns. Only its lifecycle belongs elsewhere.

```ts
run('billing', environment, {
    tablesRef: {
        orders: { name: 'orders', primaryKey: 'id', envKeyName: 'ORDERS_TABLE' },   // orders-<environment>
    },
    messagesRef: {
        orderPlaced: { name: 'order-placed', envKeyName: 'ORDER_PLACED_TOPIC' },
    },
    messageHandlerDefinitions: [{
        name: 'invoice', topic: 'orderPlaced', callback: invoice,
        resources: { table: { orders: ['dynamodb:GetItem'] } },
    }],
})
```

A definition is looked up by its physical name in the referencing stack's environment. Within one Pulumi program, you can also pass another `run()`'s result directly: `tablesRef: shop.databases`. Each kind's page says how its references are looked up.

## Where to go next

- [HTTP API](http-api): endpoints, handlers, errors, CORS and OpenAPI.
- [Permissions and environment](permissions): every grant kind, roles and environment variables.
- [`run()` reference](reference/run): every argument and return value in one place.
