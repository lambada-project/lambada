---
title: HTTP API
sidebar_label: HTTP API
slug: /http-api
description: Declare REST endpoints on API Gateway, write their handlers, and configure CORS, API keys, OpenAPI and the gateway itself.
---

Every endpoint is a route on one API Gateway REST API, backed by its own Lambda function. Endpoints are declared under `api.endpointDefinitions`:

```ts
import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'
import { getTodo, createTodo } from './api/todos'

const result = run('todos', pulumi.getStack(), {
    tables: {
        todos: { name: 'todos', primaryKey: 'userId', rangeKey: 'id', envKeyName: 'TODOS_TABLE' },
    },
    api: {
        endpointDefinitions: [
            {
                name: 'getTodo',
                path: '/todos/{id}',
                method: 'GET',
                callbackDefinition: getTodo,
                resources: { table: { todos: ['dynamodb:GetItem'] } },
            },
            {
                name: 'createTodo',
                path: '/todos',
                method: 'POST',
                callbackDefinition: createTodo,
                resources: { table: { todos: ['dynamodb:PutItem'] } },
            },
        ],
    },
})

export const apiUrl = result.api?.url
```

Routes live under `/api` on the stage `app`, so `getTodo` answers at `<apiUrl>api/todos/{id}`.

## Declaring an endpoint

| Field | Required | Description |
| --- | --- | --- |
| `path` | yes | The route under `/api`. Path parameters use braces: `/todos/{id}`. |
| `method` | yes | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` or `ANY`. |
| `callbackDefinition` | yes | The handler: see below. |
| `name` | | Names the function, its role and its logs. Derived from the project, path and method when left out (`todos-todos-id-get`). Prefer setting it. |
| `resources` | | What the function is [granted](permissions). |
| `auth` | | Which authorizer runs, and whether an API key is required: see [Authorization](#authorization). |
| `environmentVariables` | | The function's own variables. |
| `lambdaOptions` | | [Function options](functions): memory, timeout… |
| `extraHeaders` | | Headers added to every response. |
| `cache` | | `{ control: 'max-age=60' }` adds a `cache-control` header. |
| `openapi` | | Describes the operation for the [OpenAPI document](#openapi). |
| `webhook` | | Queues the request and answers at once: see [Webhooks](webhooks). |
| `useBundle` | | Deploys a pre-built folder: see [Bundles](bundles). |

## Writing a handler

A handler receives the request and the caller, and returns a value:

```ts title="src/api/todos.ts"
import type { EmbroideryCallback } from '@lambada/core'
import { getBody } from '@lambada/utils'

export const getTodo: EmbroideryCallback = async ({ request, user }) => {
    const id = request.pathParameters?.id
    const todo = await todos.get(user!.userId!, id!)
    return todo                                        // 200, JSON
}

export const createTodo: EmbroideryCallback = async ({ request, user }) => {
    const input = getBody<{ title: string }>(request)
    const todo = await todos.create(user!.userId!, input.title)
    return { statusCode: 201, body: todo }            // 201, JSON
}
```

| Argument | Type | Description |
| --- | --- | --- |
| `request` | `APIGatewayProxyEvent` | The raw API Gateway event: `pathParameters`, `queryStringParameters`, `headers`, `body`… |
| `user` | `AuthExecutionContext` | The caller, read from the authorizer: `userId` (the `sub` claim), `email`, `username`, `poolId`, `claims`, `clientIP`, `userAgent`. |
| `context` | Lambda `Context` | The invocation context. |

`getBody<T>(request)` parses a JSON body, base64 or not, and fails with a message when there is none. `tryGetBody<T>(request)` returns `undefined` instead.

### What a handler returns

- **Any value** is sent as `200` with the value as a JSON body. `undefined` becomes `{}`.
- **A response object**, with both a `statusCode` and a non-empty `body`, is sent as is. A `body` that isn't a string is serialized to JSON, and the object's `headers` are added to lambada's.

```ts
return { items }                                                   // 200 {"items":[...]}
return { statusCode: 201, body: todo }                            // 201
return { statusCode: 302, body: 'moved', headers: { Location: url } }
```

:::caution Empty bodies
A response with an empty `body`, such as `{ statusCode: 204 }`, isn't recognized as a response: it is sent as a `200` whose body is that object. Return a short body, `{ statusCode: 202, body: { accepted: true } }`, instead.
:::

No `Content-Type` is set for you. Add it to `headers` or `extraHeaders` when a client needs it.

### Errors

A thrown error is logged and answered with `500 {"error":"Bad Request"}`, so internal details don't leak. To send the client a real error, throw a `LambadaError`, which carries `showError`. Set a `statusCode` on it, from a subclass for instance:

```ts
import { LambadaError } from '@lambada/utils/error'

class NotFound extends LambadaError {
    statusCode = 404
    code = 'NOT_FOUND'
}

throw new NotFound(`Todo ${id} does not exist`)
```

```json
{
  "error": { "message": "Todo 42 does not exist", "code": "NOT_FOUND" },
  "errors": [{ "message": "Todo 42 does not exist", "code": "NOT_FOUND" }]
}
```

Setting `LAMBADA_SHOW_ALL_ERRORS=true` in a function's environment answers every error this way. That's useful in development, but not in production.

## Authorization

An endpoint is public unless it selects an authorizer or the stack sets a `defaultAuthorizer`. Declare authorizers once under `auth.authorizers`, then select one per endpoint with `auth.authorizer`. [Authorizers](authorizers) covers Cognito pools, Lambda authorizers and IAM-signed requests.

```ts
{ path: '/todos', method: 'GET', callbackDefinition, auth: { authorizer: 'user' } }   // that authorizer
{ path: '/health', method: 'GET', callbackDefinition, auth: { authorizer: false } }   // public
```

### API keys

`auth.useApiKey` creates an API key and a usage plan, and makes every endpoint require the key in the `x-api-key` header. Proxies and the CORS `OPTIONS` route don't require it. An endpoint opts out with `auth: { useApiKey: false }`.

```ts
const result = run('todos', environment, {
    auth: { useApiKey: { name: 'partners' } },
    api: { endpointDefinitions },
})

export const apiKey = result.apiKey?.keys[0].apikey.value   // a Pulumi secret
```

## CORS

`cors` adds one `OPTIONS /{path+}` route that answers every preflight request, and the headers every response carries:

```ts
run('todos', environment, {
    cors: {
        origins: ['https://app.example.com', 'http://localhost:5173'],
        headers: ['authorization', 'content-type'],
    },
    api: { endpointDefinitions },
})
```

A response allows the request's `Origin` when it's in `origins`, and the first origin otherwise. `'*'` in `origins` allows any origin.

Without `cors` there is no `OPTIONS` route, but responses still carry permissive CORS headers, allowing any origin. Browsers can't preflight that API, so it only serves simple requests.

## OpenAPI

Set `api.openAPIDocument` to publish an OpenAPI 3.1 document at `GET /api/openapi`, generated from the endpoints that carry an `openapi` description. Descriptions are written with [zod](https://zod.dev) and [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi):

```ts
import { z } from 'zod'
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'

const Todo = z.object({ id: z.string(), title: z.string(), done: z.boolean() })

run('todos', environment, {
    api: {
        openAPIDocument: {
            openapi: '3.1.0',
            info: { title: 'Todos', version: '1.0.0' },
            servers: [{ url: 'https://api.example.com/api' }],
        },
        endpointDefinitions: [{
            name: 'getTodo', path: '/todos/{id}', method: 'GET', callbackDefinition: getTodo,
            openapi: (registry: OpenAPIRegistry) => ({
                summary: 'Get a todo',
                request: { params: z.object({ id: z.string() }) },
                responses: {
                    200: { description: 'The todo', content: { 'application/json': { schema: Todo } } },
                    404: { description: 'No such todo' },
                },
            }),
        }],
    },
})
```

- Paths are written without `/api`, so put the prefix in `servers`.
- The schemas describe the API: requests aren't validated against them.
- A security scheme named `Authorization` (or the API key's name) is declared, and an operation lists it under `security` itself.
- Annotate the factory's `registry` parameter, as above, so TypeScript infers it inside `endpointDefinitions`.

## Proxies

A creator returning a `targetUri` instead of a handler forwards every request under its path to another HTTP server:

```ts
endpointDefinitions: [
    () => ({ path: '/legacy', targetUri: 'https://legacy.example.com' }),   // /api/legacy and /api/legacy/*
]
```

It takes `auth: { authorizer }` like an endpoint. Left out, it runs the stack's `defaultAuthorizer`, if any, and is public otherwise. A proxy never requires an API key.

## The gateway

| Setting | Default | Description |
| --- | --- | --- |
| `api.gatewayType` | `'EDGE'` | `'EDGE'`, `'REGIONAL'` or `'PRIVATE'`. A private API is dual-stack and reachable through `api.vpcEndpointIds`. |
| `api.policy` | none | The API's resource policy, as a JSON string. A private API needs one to admit its VPC endpoints. |
| `api.stage` | `{ name: 'app' }` | The stage `name` and its `variables`. |
| `naming.apiPath` | `'/api'` | The prefix of every route. `''` puts routes at the root. |
| `options.dependsOn` | none | Resources the API waits for. |

Every API also answers a denied request (403) with a JSON body built from the authorizer's message, carrying permissive CORS headers so a browser can read it.

## Lower-level helpers

A declaration can also be a [creator](concepts#plain-declarations-and-creators): a function from the stack's resources to the declaration. `createEndpointSimple`, `createEndpointSimpleCors`, `createEndpoint` and `createProxyIntegration` build routes from positional arguments inside one. They predate the declaration objects above and are kept for existing stacks: prefer the plain objects, which the stack checks before it builds anything.
