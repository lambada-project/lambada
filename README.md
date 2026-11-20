# Lambada

**Serverless AWS stacks in TypeScript, declared by name.**

Lambada is an opinionated layer over [Pulumi](https://www.pulumi.com). You describe tables, queues, topics and endpoints in one `run()` call, and each function is granted, by name, exactly the resources it uses. That means least-privilege IAM and wired environment variables, all checked before anything deploys.

📖 **Documentation: [lambada-project.github.io](https://lambada-project.github.io)**

```ts
import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'
import { placeOrder, sendReceipt } from './orders'

const result = run('shop', pulumi.getStack(), {
    tables: {
        orders: { name: 'orders', primaryKey: 'id', envKeyName: 'ORDERS_TABLE' },
    },
    messages: {
        orderPlaced: { name: 'order-placed', envKeyName: 'ORDER_PLACED_TOPIC' },
    },
    api: {
        endpointDefinitions: [{
            name: 'placeOrder',
            path: '/orders',
            method: 'POST',
            callbackDefinition: placeOrder,
            resources: {
                table: { orders: ['dynamodb:PutItem'] },
                topic: { orderPlaced: ['sns:Publish'] },
            },
        }],
    },
    messageHandlerDefinitions: [{
        name: 'sendReceipt',
        topic: 'orderPlaced',
        callback: sendReceipt,
        resources: { table: { orders: ['dynamodb:GetItem'] } },
    }],
})

export const apiUrl = result.api?.url
```

`placeOrder` may only put orders and publish to that topic, and it reads both names from `process.env`. Misspell a name in a grant and `pulumi preview` fails, listing what the stack does have.

## Features

- **Grants by name.** Functions list the resources and actions they need. Lambada writes their IAM and their environment.
- **Checked before deploy.** Every name is resolved before any function is built, so `pulumi preview` catches mistakes. Filter policies and schedules are typed against what AWS accepts.
- **The serverless core.** API Gateway with authorizers, CORS, API keys and OpenAPI, plus Lambda, DynamoDB, S3, SNS, SQS, EventBridge schedules, KMS, Secrets Manager and Cognito.
- **Environments for free.** Resources are named per Pulumi stack, so environments share an account without clashing.
- **Still Pulumi.** `run()` returns what it builds. Anything else is plain Pulumi next to it.

## Get started

Follow the [Quickstart](https://lambada-project.github.io/quickstart) to deploy an API with a table in about ten minutes, or scaffold a project with tests and a devcontainer:

```bash
npm init @lambada my-app
```

For a fuller stack (a topic, a queue, a schedule and a React app behind CloudFront), see [`example/`](example).

## Packages

| Package | |
| --- | --- |
| [`@lambada/core`](packages/core) | `run()` and everything it builds |
| [`@lambada/utils`](packages/utils) | Runtime helpers for handlers, with no Pulumi dependency |
| [`@lambada/create`](packages/create) | Project initializer (`npm init @lambada`) |

## Contributing

```bash
npm ci
npm run build
npm test
```

The documentation site lives in [`docs/`](docs): `cd docs && npm ci && npm start`.
