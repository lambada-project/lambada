---
title: Authorizers
sidebar_label: Authorizers
slug: /authorizers
---

## Declare them once

Every authorizer the API can run is declared under `auth.authorizers`, by the name endpoints select it with. An entry is a Cognito pool from `pools` or `poolsRef`, or a lambda authorizer.

```ts
run('orders', environment, {
    poolsRef: { admins: { id: adminPoolId, arn: adminPoolArn, envKeyName: 'ADMIN_POOL_ID' } },
    auth: {
        authorizers: {
            admin: { pool: 'admins' },
            pin: awsx.apigateway.getRequestLambdaAuthorizer({ headers: ['Authorization'], handler: { uri, credentials } }),
            noPin: awsx.apigateway.getRequestLambdaAuthorizer({ headers: ['Authorization'], handler: { uri: noPinUri, credentials } }),
        },
        defaultAuthorizer: 'noPin',
    },
    api: { endpointDefinitions },
})
```

## Select one per endpoint

```ts
{ path: '/offers', method: 'POST', callbackDefinition, auth: { authorizer: 'pin' } }  // that authorizer
{ path: '/offers', method: 'GET', callbackDefinition, auth: { authorizer: false } }   // public
{ path: '/offers/{id}', method: 'GET', callbackDefinition }                           // the default
```

Without `defaultAuthorizer`, an endpoint that selects nothing is public. Proxy integrations, `createEndpointSimple` and `createEndpointSimpleCors` take the same `auth.authorizer`; `createEndpoint` takes the name or `false` as its last argument.

Every name is checked before anything is built. Names that are not declared, and pools that are not in `pools` or `poolsRef`, are reported together with the other missing resources.

## One authorizer per method

API Gateway runs a single authorizer on a method, and refuses to import one with two ("Only one Authorizer or IAM authorization is allowed per operation"). So an endpoint selects one name. A pool and a lambda authorizer cannot share a method; to accept both kinds of token, have the lambda authorizer verify the pool's tokens itself.

## Names

The key is the authorizer's name in API Gateway, and for a lambda authorizer whose handler is a function, the name of the function awsx builds for it. It replaces the authorizer's own `authorizerName`.

- Keys use up to 1024 letters, digits, `-` and `_`. API Gateway refuses other characters, and Lambda refuses `.` in a function name.
- `api_key`, and names every object has such as `constructor` or `toString`, are refused: awsx uses them itself.

## Moving from the deprecated fields

`auth.lambdaAuthorizers`, `auth.authorizerPools`, `auth.extraAuthorizers`, and an endpoint's `useCognitoAuthorizer`, `lambdaAuthorizer` or `enableAuth` keep working as before. A stack uses one style or the other: setting fields of both is refused, naming the field.

| Before | After |
| --- | --- |
| `auth.extraAuthorizers: [authorizer]` | `auth.authorizers: { name: authorizer }`, `auth.defaultAuthorizer: 'name'` |
| `auth.extraAuthorizers: [poolArn]` or `auth.authorizerPools: ['key']` | `auth.authorizers: { name: { pool: 'key' } }`, `auth.defaultAuthorizer: 'name'` |
| endpoint `auth.lambdaAuthorizer: authorizer` | endpoint `auth.authorizer: 'name'` |
| endpoint `auth.useCognitoAuthorizer: false` | endpoint `auth.authorizer: false` |
| endpoint `auth.useCognitoAuthorizer: true` | leave `auth` out |

With `auth.createCognito`, the pool it creates no longer authorizes every endpoint; declare it as `{ pool: 'userPool' }` and select it where it applies.

What a deployed stack sees when it switches:

- A lambda authorizer pointing at an existing function (`handler: { uri, credentials }`) under a key equal to its current `authorizerName`: no change.
- Under another key, or a Cognito authorizer, which the deprecated fields left unnamed: the authorizer is renamed. The RestApi and its Stage update in place and a new Deployment replaces the old one. No function, role or permission changes.
- A lambda authorizer whose handler is a function, under another key: its function and role are replaced as well.
