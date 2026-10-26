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
- `resources` is what the actions apply to, one ARN or several.
- `environment` is set on every function granted the resource. A function not granted it does not see it.

A grant naming a key `customRef` lacks is reported with the other missing resources. Functions granting the same actions on the same resources share a role, as they do for any kind. `grant()` takes custom grants too.

A custom resource that more than one service needs is a candidate to become a kind. A kind that replaces one grants the same statements, so moving a grant to it leaves the role as it was.

## OpenSearch

The domain is built with plain Pulumi next to run(), and its ARN and endpoint go in `customRef`, as above. Each request to the domain is signed with SigV4 for the service `es`.
