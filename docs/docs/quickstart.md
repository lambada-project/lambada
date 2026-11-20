---
title: Quickstart
sidebar_label: Quickstart
slug: /quickstart
description: Deploy an API with a DynamoDB table to your AWS account in about ten minutes.
---

You'll deploy a small to-do API: two endpoints backed by a DynamoDB table. Along the way you'll see the three things every lambada stack does: declare resources, declare functions, and grant one to the other.

## Before you start

You need:

- **Node.js 20 or newer**.
- **The [Pulumi CLI](https://www.pulumi.com/docs/install/)**, logged in to a backend: `pulumi login` for Pulumi Cloud (free for individuals), or `pulumi login --local` to keep state on your machine.
- **An AWS account** with credentials your terminal can use: `aws sts get-caller-identity` should print your account. See [AWS credentials](aws-config) if you use profiles.

## 1. Create the project

Start from Pulumi's AWS TypeScript template, then add lambada:

```bash
mkdir todos && cd todos
pulumi new aws-typescript --name todos --stack dev

# What the functions use at runtime
npm install @lambada/utils @aws-sdk/client-dynamodb@~3.981.0 @aws-sdk/lib-dynamodb@~3.981.0

# What only deploying uses
npm install --save-dev @lambada/core \
  @aws-sdk/client-kms@~3.981.0 @aws-sdk/client-s3@~3.981.0 @aws-sdk/client-sns@~3.981.0
```

`pulumi new` creates `index.ts`, `Pulumi.yaml` and a `dev` stack, and asks for an AWS region. npm installs lambada's peer dependencies (`@pulumi/awsx`, `zod`…) along with it.

:::note Why two installs
Pulumi uploads every package under `dependencies` with each function. `@lambada/core` is only needed while deploying, and it brings large packages with it, so it belongs in `devDependencies`. The AWS SDK versions are pinned because lambada declares its SDK peers at `~3.981.0`. The KMS, S3 and SNS clients are listed because `@lambada/core` loads or references them without declaring them.
:::

:::tip Or scaffold it
`npm init @lambada todos` creates this same app with a devcontainer and tests that run against AWS Emulator.
:::

## 2. Declare the stack

Replace `index.ts` with:

```ts title="index.ts"
import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'
import { listTodos, addTodo } from './todos'

const result = run('todos', pulumi.getStack(), {
    tables: {
        todos: {
            name: 'todos',
            primaryKey: 'listId',
            rangeKey: 'id',
            envKeyName: 'TODOS_TABLE',
        },
    },
    api: {
        endpointDefinitions: [
            {
                name: 'listTodos',
                path: '/lists/{listId}/todos',
                method: 'GET',
                callbackDefinition: listTodos,
                resources: { table: { todos: ['dynamodb:Query'] } },
            },
            {
                name: 'addTodo',
                path: '/lists/{listId}/todos',
                method: 'POST',
                callbackDefinition: addTodo,
                resources: { table: { todos: ['dynamodb:PutItem'] } },
            },
        ],
    },
})

export const apiUrl = result.api?.url
```

This declares:

- a **table** under the key `todos`. It will be named `todos-dev`, and every function granted it reads that name from `TODOS_TABLE`;
- two **endpoints**, each backed by its own Lambda function;
- the **grants**: `listTodos` may only query the table, and `addTodo` may only put items in it.

## 3. Write the handlers

Create `todos.ts` next to it:

```ts title="todos.ts"
import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { EmbroideryCallback } from '@lambada/core'
import { getBody } from '@lambada/utils'

// Created on first use, inside Lambda: a client built at deploy time can't be serialized.
let client: DynamoDBDocumentClient | undefined
const db = () => client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const listTodos: EmbroideryCallback = async ({ request }) => {
    const { Items } = await db().send(new QueryCommand({
        TableName: process.env.TODOS_TABLE,
        KeyConditionExpression: 'listId = :listId',
        ExpressionAttributeValues: { ':listId': request.pathParameters?.listId },
    }))
    return { todos: Items ?? [] }
}

export const addTodo: EmbroideryCallback = async ({ request }) => {
    const { title } = getBody<{ title: string }>(request)
    const todo = { listId: request.pathParameters?.listId, id: randomUUID(), title, done: false }
    await db().send(new PutCommand({ TableName: process.env.TODOS_TABLE, Item: todo }))
    return { statusCode: 201, body: todo }
}
```

A handler receives `{ request, user }` and returns a value, which is sent as JSON. `process.env.TODOS_TABLE` is there because the endpoint granted the table.

:::caution Create SDK clients inside Lambda
Pulumi deploys each handler by serializing it with everything it references. A client created at the top of the module, `const db = new DynamoDBClient({})`, is a live object holding credential providers, and Pulumi can't serialize it. `pulumi up` fails with `Error serializing … it was a native code function`. Create clients on first use, as above: warm invocations still reuse them. See [Function options](functions#what-a-handler-captures).
:::

## 4. Deploy

```bash
pulumi up
```

Pulumi previews what it will create: the table, two functions with their roles and policies, the API and its stage, and a resource group for the stack. Choose `yes`. A minute or two later it prints `apiUrl`.

Routes live under `/api`. Try them:

```bash
API=$(pulumi stack output apiUrl)

curl -X POST "${API}api/lists/groceries/todos" -d '{"title":"Oat milk"}'
curl "${API}api/lists/groceries/todos"
```

```json
{"todos":[{"listId":"groceries","id":"9b0e…","title":"Oat milk","done":false}]}
```

## 5. Make a mistake on purpose

Change one grant to a table that doesn't exist, `{ table: { todo: ['dynamodb:Query'] } }`, and run `pulumi preview`:

```text
Lambada found 1 resource that is granted but absent from the stack:

  listTodos  table 'todo' — the stack has: todos

Correct the names, or add the resources to run().
```

The preview stops there. lambada checks every name before it builds any function, so the mistake never reaches AWS. Put the name back.

## 6. Clean up

```bash
pulumi destroy
```

## Next steps

- [Core concepts](concepts): how `run()`, names, grants and environments fit together.
- [HTTP API](http-api): status codes, errors, CORS, API keys and OpenAPI.
- [Authorizers](authorizers): put a Cognito pool or a Lambda authorizer in front of your endpoints.
- [Queues](queues), [Topics](topics) and [Schedules](schedules): functions that run without a request.
- [Testing](testing): run your handlers against an emulator.
- [The example app](https://github.com/lambada-project/lambada/tree/main/example): a topic, a queue, a schedule and a React app behind CloudFront, in one stack.
