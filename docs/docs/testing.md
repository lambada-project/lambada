---
title: Testing
sidebar_label: Testing
slug: /testing
description: Unit-test handlers with mock requests, and integration-test them against real resources created from your stack's declarations.
---

lambada's declarations are plain objects, so a test can reuse them. A test creates the same tables, queues and topics the stack declares in an emulator, publishes their names through the same `envKeyName` variables, and calls your handlers directly.

## Keep declarations importable

Declare resources in their own module, and import it from both the stack and the tests:

```ts title="src/resources.ts"
export const tables = {
    todos: { name: 'todos', primaryKey: 'listId', rangeKey: 'id', envKeyName: 'TODOS_TABLE' },
}

export const queues = {
    emails: { name: 'emails', envKeyName: 'EMAILS_QUEUE', options: { visibilityTimeoutSeconds: 120 } },
}
```

```ts title="index.ts"
import { tables, queues } from './src/resources'

run('todos', pulumi.getStack(), { tables, queues, api: { endpointDefinitions } })
```

## What the setup creates

`ConfigureAwsEnvironment(config)` creates every resource the config names, and sets each one's `envKeyName` in `process.env`. `RemoveResources(config)` deletes them again.

| Kind | Created as | `envKeyName` holds |
| --- | --- | --- |
| `tables` | `[<tablePrefix>-]<name>[-<environment>]` | the table name |
| `queues` | `<name>[-<environment>][.fifo]` | the queue URL |
| `messages` | `<name>[-<environment>]` | the topic ARN |
| `buckets` | `<name>[-<environment>]` | the bucket name |
| `keys` | alias `alias/[<project>-]<name>[-<environment>]` | the key ARN |
| `secrets` | `[<project>-]<name>[-<environment>]` | the secret name |

`projectName`, `environment` and `tablePrefix` are optional. Left out, resources take their bare `name`. Set them to match the stack when your tests should use the deployed names.

**Tables** are created `PAY_PER_REQUEST` with their keys, `attributes` and indexes, and the setup returns once each table and its global secondary indexes are `ACTIVE`. TTL, streams, encryption and seed `data` aren't applied. An attribute that no key or index uses, or an index key that isn't declared, is refused before anything is created, as DynamoDB would refuse it. Write indexes with `hashKey` and `rangeKey`: indexes written with `keySchemas` aren't supported here.

**Queues** are created with the `fifoQueue`, `contentBasedDeduplication`, `deduplicationScope` and `visibilityTimeoutSeconds` of their declaration. Their other options don't reach a test queue.

**An existing resource is reused**, so a run that was interrupted doesn't fail the next one.

The setup also sets `AWS_REGION` from the DynamoDB or KMS client config.

## Point the setup at an emulator

Each service takes its own client config under `aws`. Give each the emulator's endpoint, one region, and credentials:

```ts title="test/setup.ts"
import { ConfigureAwsEnvironment, RemoveResources, type LambadaEnvironmentConfig } from '@lambada/core'
import { tables, queues } from '../src/resources'

const emulator = {
    endpoint: 'https://127.0.0.1:9297',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
}

export const config: LambadaEnvironmentConfig = {
    options: {
        environment: 'test',
        aws: { dynamodb: emulator, kms: emulator, sqs: emulator },
        tables,
        queues,
    },
}

beforeAll(() => ConfigureAwsEnvironment(config))
afterAll(() => RemoveResources(config))
```

The clients in your own code need the same endpoint. The setup configures only its own clients. Call `RemoveResources` in the same process as `ConfigureAwsEnvironment`. Apart from tables, it reaches the services through the client config the setup was given.

### SQS: keep each client on the emulator

The AWS SDK sends an SQS request to the host of the queue URL when the client has no `endpoint` option, that is, when its endpoint comes from `AWS_ENDPOINT_URL` or from the region. AWS Emulator answers queue URLs on the host of the real SQS endpoint, so such a client sends its requests, signed with the test credentials, to AWS.

The setup builds its own SQS client with `useQueueUrlAsEndpoint: false`, and a value in `aws.sqs` wins. The queue URL the setup publishes carries the host the emulator answered, so give each SQS client in your own code `useQueueUrlAsEndpoint: false` or an explicit `endpoint`.

The teardown skips a queue that doesn't exist, and fails on any other error from the lookup.

## Running AWS Emulator

:::tip Already wired in the starter
A project from `npm init @lambada` installs AWS Emulator in its devcontainer, and its `npm test` runs `scripts/test.sh`, which does everything in this section: it starts a fresh emulator, waits for it, sets `NODE_EXTRA_CA_CERTS` and `AWS_ENDPOINT_URL`, runs `bun test`, and stops the emulator.
:::

[AWS Emulator](https://docs.aws.amazon.com/emulator/latest/userguide/) runs on Linux, from AWS's `.deb` or `.rpm` packages, and on macOS and Windows in a container. These are the services that were run against it: DynamoDB, KMS and SQS.

Start the emulator on `127.0.0.1`, with telemetry and authentication off:

```bash
EMULATOR_TELEMETRY=off aws-emulator -b 127.0.0.1 -p 9297 --telemetry off --auth off
```

With `--auth off` the emulator accepts any credentials, so the dummy values above are enough.

### Trust its certificate

The emulator serves HTTPS only. It writes a new certificate authority at each start, to `~/.aws/emulator/9297/ca.pem`. The certificate names `localhost`, `127.0.0.1` and `::1`, so the test process must run where those names reach the emulator.

Set `NODE_EXTRA_CA_CERTS` to that file before the test process starts, and after the emulator has started. A value from an earlier start names a certificate authority that no longer exists.

Bun reads only the first certificate of a file that holds several.

### Reset the state

The emulator has no reset route. There are two ways to reset it:

- Call `RemoveResources` with the same config. It deletes the config's resources, and waits until the tables are gone.
- Restart the emulator. Set `NODE_EXTRA_CA_CERTS` again after the restart.

Call `RemoveResources` between test files, and restart the emulator between runs.

## Calling a handler

An endpoint handler is a plain async function, so a test calls it directly. `getMockRequest(authenticated, body?, query?)` builds the argument a handler receives, `{ request, user, context }`, around an API Gateway event:

```ts title="src/todos.test.ts"
import { getMockRequest } from '@lambada/core'
import { addTodo, listTodos } from './todos'
import '../test/setup'

test('adds a todo and lists it', async () => {
    const add = getMockRequest(true, { title: 'Oat milk' })
    add.request.pathParameters = { listId: 'groceries' }
    const created: any = await addTodo(add)
    expect(created.statusCode).toBe(201)

    const list = getMockRequest(true, undefined, '?limit=10')
    list.request.pathParameters = { listId: 'groceries' }
    const result: any = await listTodos(list)
    expect(result.todos).toHaveLength(1)
})
```

- `body` is serialized to JSON.
- `query` is a query string (`'?a=1&a=2'`) or a record (`{ a: ['1', '2'] }`), and fills `queryStringParameters` and `multiValueQueryStringParameters` the way API Gateway does.
- The request carries a fixed Cognito identity, whatever `authenticated` says. Set `user` yourself to test as another caller.

Calling the callback directly skips the wrapper, so you get the value it returned, not the HTTP response. To test the response too (status, headers and error handling), wrap it the way lambada does:

```ts
import { createHandler } from '@lambada/utils/handler'

const { request } = getMockRequest(true, { title: 'Oat milk' })
request.pathParameters = { listId: 'groceries' }

const response = await createHandler(addTodo)(request, { callbackWaitsForEmptyEventLoop: false } as any)
expect(response.statusCode).toBe(201)
expect(JSON.parse(response.body)).toMatchObject({ title: 'Oat milk' })
```

The handlers' own SDK clients must reach the emulator too. Setting `AWS_ENDPOINT_URL` for the test process does that for most clients. SQS clients also need `useQueueUrlAsEndpoint: false`, [as above](#sqs-keep-each-client-on-the-emulator). Clients created on first use, as they [should be](functions#what-a-handler-captures), are created after the test has set those values.
