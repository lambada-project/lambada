---
title: '@lambada/utils'
sidebar_label: '@lambada/utils'
slug: /reference/utils
description: Runtime helpers for handlers — requests, errors, CORS, repositories, secrets and Cognito users.
---

`@lambada/utils` is what your handlers import at runtime. It has no Pulumi dependency, so it is light enough for a [bundle](../bundles).

```bash
npm install @lambada/utils
```

| Import | Exports |
| --- | --- |
| `@lambada/utils` | Everything below except `LambadaError`, `SecretsManagerCache` and the marshaller. It also loads the Cognito client. |
| `@lambada/utils/handler` | `createHandler`, `wrapperConfigFromEnv`, `toWrapperEnvVars`, `WRAPPER_ENV` |
| `@lambada/utils/request` | `getBody`, `tryGetBody`, `getContext`, `AuthExecutionContext` |
| `@lambada/utils/error` | `LambadaError` |
| `@lambada/utils/cors` | `getCorsHeaders`, `getRequestOrigin` |
| `@lambada/utils/repository` | `RepositoryBase` |
| `@lambada/utils/users` | `isUserInGroup`, `getUser`, `getUserById` |
| `@lambada/utils/dist/secretManager` | `SecretsManagerCache` |
| `@lambada/utils/dist/dynamoMarshaller` | `DefaultMarshaller`, `IMarshaller` |

## Requests

```ts
import { getBody, tryGetBody } from '@lambada/utils/request'

const input = getBody<{ title: string }>(request)      // throws a LambadaError when there's no body
const maybe = tryGetBody<{ title: string }>(request)   // undefined when there's no body
```

Both decode a base64 body and parse it as JSON. Invalid JSON throws a `SyntaxError`, which the handler wrapper answers with a 500.

`getContext(request)` reads the caller from the authorizer's context, and is what fills an endpoint's `user`:

| Field | From |
| --- | --- |
| `userId` | the `sub` claim |
| `username` | `username`, or `cognito:username` |
| `email` | the `email` claim |
| `poolId` | the last segment of the `iss` claim |
| `claims` | every claim, and a Lambda authorizer's context |
| `clientIP`, `userAgent` | the request's identity |
| `hashedAuthorizationToken` | the SHA-256 of the `Authorization` header |

## Errors

```ts
import { LambadaError } from '@lambada/utils/error'

class Conflict extends LambadaError {
    statusCode = 409
    code = 'CONFLICT'
}

throw new Conflict('A todo with that title exists')
```

A `LambadaError` is shown to the client: its `statusCode` (500 if unset), its `message` and `code`, and any `data` you set on it. Any other error is answered with a bare 500. See [HTTP API](../http-api#errors).

## The handler wrapper

`createHandler(callback, config)` turns an endpoint callback into an API Gateway proxy handler. lambada applies it to every endpoint it serializes, and a [bundled](../bundles) endpoint applies it itself:

```ts
import { createHandler, wrapperConfigFromEnv } from '@lambada/utils/handler'

export const handler = createHandler(async ({ request, user }) => ({ ok: true }), wrapperConfigFromEnv())
```

It parses the caller into `user`, adds CORS and extra headers, serializes the result, and turns errors into responses as described in [What a handler returns](../http-api#what-a-handler-returns). `wrapperConfigFromEnv()` reads the CORS, header and cache settings lambada sets on a bundled function.

## Repositories

`RepositoryBase` is a small base class for one DynamoDB table. Its constructor takes the table's definition, the same object you declare in `tables`, and reads the physical name from the definition's `envKeyName`:

```ts
import { RepositoryBase } from '@lambada/utils/repository'
import { tables } from '../tables'

type Todo = { listId: string, id: string, title: string }

export class TodoRepository extends RepositoryBase {
    constructor() { super(tables.todos) }

    list(listId: string) {
        return this.query<Todo>({ name: 'listId', value: listId })
    }

    get(listId: string, id: string) {
        return this.getById<Todo>({ name: 'listId', value: listId }, { name: 'id', value: id })
    }

    save(todo: Todo) {
        return this.upsert(todo)
    }
}
```

| Method | Does |
| --- | --- |
| `query(primaryKey, rangeKey?, indexName?)` | Queries by key, optionally on an index. Returns the first page. |
| `getById(primaryKey, rangeKey?)` | A consistent `GetItem`, or `null`. |
| `upsert(item)` | `PutItem`. |
| `scan({ filter?, filterValues? })` | Scans the first page. |

`RepositoryExtended`, exported from the root, adds:

- `queryBegins_with`, which pages with `limit` and `lastKey`;
- `queryCondition`, which compares the sort key (`EQ`, `GT`, `BEGINS_WITH`, `BETWEEN`…) and returns one page;
- `updateItem`, which updates an item that already exists;
- `fullScan`, which follows every page.

:::caution Construct repositories inside the handler
The constructor reads the table name from the environment. A repository created at the top of a module is constructed when Pulumi deploys the stack, where that variable isn't set, and falls back to the bare table name. Construct it inside the handler, or on first use.
:::

All repositories in a process share one DynamoDB client, created with the configuration of the first repository that makes a call.

## Secrets

```ts
import { SecretsManagerCache } from '@lambada/utils/dist/secretManager'

const raw = await SecretsManagerCache.get().getSecret(process.env.STRIPE_SECRET!)
const json = await SecretsManagerCache.get().getSecret(process.env.STRIPE_SECRET!, true)   // parsed
```

Values are cached for five minutes per container. Only string secrets are supported. Grant the secret with `secretsmanager:GetSecretValue`: see [Keys and secrets](../keys-and-secrets#secrets).

## Cognito users

```ts
import { isUserInGroup, getUser } from '@lambada/utils/users'
import { LambadaError } from '@lambada/utils/error'

class Forbidden extends LambadaError { statusCode = 403 }

if (!await isUserInGroup(user!, 'admins')) throw new Forbidden('Admins only')
const profile = await getUser(user!.username!, user!)
```

| Function | Needs |
| --- | --- |
| `isUserInGroup(user, group)` | Reads the `cognito:groups` claim, then asks Cognito: `cognito-idp:AdminListGroupsForUser`. |
| `getUser(username, user)` | `cognito-idp:AdminGetUser` |
| `getUserById(userId, poolId)` | `cognito-idp:ListUsers` |

Users are cached for the life of the container.

## CORS

`getCorsHeaders(origin, origins, headers)` returns the CORS headers lambada adds to responses: the request's origin when it's allowed, else the first allowed origin, or `*` when `origins` is unset or contains `*`. `getRequestOrigin(headers)` reads the `Origin` header regardless of case.
