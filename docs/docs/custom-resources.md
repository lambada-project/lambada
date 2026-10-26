---
title: Custom resources
sidebar_label: Custom resources
slug: /custom-resources
---

## A resource lambada has no kind for

A table, a bucket or a queue is a kind: run() knows its IAM service, the ARNs its actions apply to, and the variable a granted function reads it from. A resource lambada has no kind for is declared under `customRef` with those three things, and granted by name like the others.

```ts
run('pets', environment, {
    customRef: {
        search: {
            service: 'es',
            resources: [domain.arn, pulumi.interpolate`${domain.arn}/*`],
            environment: { SEARCH_ENDPOINT: domain.endpoint },
        },
    },
    api: {
        endpointDefinitions: [{
            name: 'findPets', path: '/pets', method: 'GET', callbackDefinition,
            resources: { custom: { search: ['es:ESHttpGet', 'es:ESHttpPost'] } },
        }],
    },
})
```

- `service` is the IAM prefix every granted action must carry: `es`, `aoss`, `execute-api`. An action of another service is refused before anything is built, naming the function; case is ignored, as IAM ignores it.
- `arnService` is the service the resources' ARNs name, when it differs from `service`: the Data API's actions are `rds-data:*` and its cluster is `arn:aws:rds:…`, so `{ service: 'rds-data', arnService: 'rds' }`. Left out, it is `service`.
- `resources` is what the actions apply to, one ARN or several, each of `arnService` with partition, region and account spelled out. `*`, an ARN of another service, or one naming every resource of its service is refused; a wildcard within the resource, such as a domain's paths, is how a service scopes its own and is accepted.
- A wildcard action (`es:*`, `es:ESHttp*`) is refused: each action is named.
- `iam` and `sts` are refused as services: a grant of them lets a function give itself more.

What the slot refuses can still be stated in a function's `policyStatements`, where it is written and reviewed as the statement IAM receives.
- `environment` is set on every function granted the resource. A function not granted it does not see it.

A grant naming a key `customRef` lacks is reported with the other missing resources. Functions granting the same actions on the same resources share a role, as they do for any kind. `grant()` takes custom grants too.

A custom resource that more than one service needs is a candidate to become a kind. A kind that replaces one grants the same statements, so moving a grant to it leaves the role as it was.

## OpenSearch

The domain is built with plain Pulumi next to run(), and its ARN and endpoint go in `customRef`, as above. Each request to the domain is signed with SigV4 for the service `es`.

## An internal API

An API whose routes are signed (see [Signed requests](authorizers#signed-requests)) admits a caller whose IAM policy allows `execute-api:Invoke` on the route. In the caller's stack, the API is a custom resource with the routes it may call:

```ts
customRef: {
    users: {
        service: 'execute-api',
        resources: [
            'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/GET/api/users/*',
            'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/POST/api/users',
        ],
        environment: { USERS_API_URL: 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/app' },
    },
},
// ...
resources: { custom: { users: ['execute-api:Invoke'] } }
```

A route is `arn:aws:execute-api:{region}:{account}:{apiId}/{stage}/{METHOD}/{path}`, and `*` matches any stage, method or path segment. The caller signs each request with its role's credentials, using SigV4 for the service `execute-api`, for example with `@smithy/signature-v4`.

When both stacks are in the same account, the caller's IAM policy is enough. A caller in another account also needs the API's resource policy (`api.policy`) to allow its role; that case has not been measured.
