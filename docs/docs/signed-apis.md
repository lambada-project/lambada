---
title: Signed APIs
sidebar_label: Signed APIs
slug: /signed-apis
description: Require SigV4 on routes, and grant them to another stack's functions by name.
---

An API's signed routes are granted to another stack's functions the way a table is: by name, per function, as IAM on the caller's role. The API lists no callers.

## The API's stack

Routes selecting a `{ iam: true }` authorizer require a SigV4 signature (see [Signed requests](authorizers#signed-requests)). run() returns them as `signedApi`, ready for another stack:

```ts
const result = run('users', environment, {
    auth: { authorizers: { internal: { iam: true } } },
    api: {
        endpointDefinitions: [
            { name: 'getUser', path: '/users/{id}', method: 'GET', callbackDefinition, auth: { authorizer: 'internal' } },
            { name: 'lockUser', path: '/users/{id}/lock', method: 'POST', callbackDefinition, auth: { authorizer: 'internal' } },
        ],
    },
})
export const signedApi = result.signedApi
// { executionArn, url, stage: 'app', routes: ['GET /api/users/{id}', 'POST /api/users/{id}/lock'] }
```

The routes are read from the definition API Gateway imports, after lambada requires the signature, so they are exactly the routes that check a caller's IAM.

## The caller's stack

```ts
const users = new pulumi.StackReference(`org/users/${environment}`)

run('store', environment, {
    apisRef: { users: { api: users.getOutput('signedApi'), envKeyName: 'USERS_API_URL' } },
    api: {
        endpointDefinitions: [{
            name: 'checkout', path: '/orders', method: 'POST', callbackDefinition,
            resources: { api: { users: ['GET /api/users/{id}'] } },
        }],
    },
})
```

`checkout` may invoke `GET /api/users/{id}` and nothing else, and reads the stage's URL from `USERS_API_URL`; a route's path follows it. A function that grants nothing from `users` gets neither. The function signs each request with its role's credentials, using SigV4 for the service `execute-api`, for example with `@smithy/signature-v4`.

- A key `apisRef` lacks is reported with the other missing resources, before any function is built.
- A route the API does not sign is refused at preview, listing the routes it does sign.

## What IAM matches

IAM matches the request's path, not the route's template, so a parameter becomes `*` in the ARN, and IAM's `*` also spans `/`. Measured: a grant of the literal `.../GET/users/{id}` admitted no request at all, and a grant of `.../GET/users/*` also admitted `/users/1/sessions`.

So a grant of `GET /api/users/{id}` would also admit `GET /api/users/{id}/sessions` or `GET /api/users/me`, if the API signs those. lambada refuses such a grant, naming every route it would reach: grant those too, or give the routes paths that do not nest. Which route a request reaches follows API Gateway's documented most specific match (not measured here), a static segment over a parameter over `{proxy+}`, so granting `GET /api/users/me` alone is fine beside `GET /api/users/{id}`.

A grant takes effect within seconds; a changed or revoked one took more than 30 seconds to settle on every request.

## Another account

The API's resource policy (`api.policy`) must also allow the caller's role. That case has not been measured.
