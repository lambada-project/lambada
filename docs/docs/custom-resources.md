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
        petsDomain: {
            service: 'es',
            resources: [petsDomain.arn, pulumi.interpolate`${petsDomain.arn}/*`],
            environment: { PETS_DOMAIN_ENDPOINT: petsDomain.endpoint },
        },
    },
    api: {
        endpointDefinitions: [{
            name: 'findPets', path: '/pets', method: 'GET', callbackDefinition,
            resources: { custom: { petsDomain: ['es:ESHttpGet', 'es:ESHttpPost'] } },
        }],
    },
})
```

- `service` is the IAM prefix every granted action must carry: `es`, `aoss`, `execute-api`. An action of another service is refused before anything is built, naming the function; case is ignored, as IAM ignores it.
- `arnService` is the service the resources' ARNs name, when it differs from `service`: the Data API's actions are `rds-data:*` and its cluster is `arn:aws:rds:…`, so `{ service: 'rds-data', arnService: 'rds' }`. Left out, it is `service`.
- `resources` is what the actions apply to, one ARN or several, each of `arnService` with partition, region and account spelled out. `*`, an ARN of another service, or one naming every resource of its service is refused; a wildcard within the resource, such as a domain's paths, is how a service scopes its own and is accepted.
- A wildcard action (`es:*`, `es:ESHttp*`) is refused: each action is named.
- `iam` and `sts` are refused as services: a grant of them lets a function give itself more.
- `environment` is set on every function granted the resource. A function not granted it does not see it.

What the slot refuses can still be stated in a function's `policyStatements`, where it is written and reviewed as the statement IAM receives.

A key names the resource, not what it is for: `petsDomain`, not `search`. One purpose can be served by several services, and a reader of the grant should know which one it reaches.

A grant naming a key `customRef` lacks is reported with the other missing resources. Functions granting the same actions on the same resources share a role, as they do for any kind. `grant()` takes custom grants too.

A custom resource that more than one service needs is a candidate to become a kind. A kind that replaces one grants the same statements, so moving a grant to it leaves the role as it was.

## OpenSearch

OpenSearch has two flavors, and IAM treats them as separate services.

**A managed domain** is the service `es`: its ARN is `arn:aws:es:<region>:<account>:domain/<name>`, and its actions are `es:ESHttpGet`, `es:ESHttpPost` and the other `es:ESHttp*` methods. The domain is built with plain Pulumi next to run(), and its ARN and endpoint go in `customRef`, as above. The grant is one of three checks a request passes:

- The function signs each request with SigV4 for the service `es`. A client that authenticates with the fine-grained access control master user's name and password is not checked against the function's role, so a grant adds nothing for it.
- The domain's access policy admits the role, or the account.
- With fine-grained access control on, the role is mapped to an OpenSearch role that permits the request.

**A serverless collection** is the service `aoss`: its ARN is `arn:aws:aoss:<region>:<account>:collection/<id>`, and its actions are `aoss:APIAccessAll` and `aoss:DashboardsAccessAll`. IAM alone does not admit a request to it: the collection's data access policy (`aws.opensearch.ServerlessAccessPolicy`) must also name the caller as a principal. Name the account, `arn:aws:iam::<account>:root`, and the policy admits every role of the account that IAM allows, so the `customRef` grant is again what decides: a role granted `aoss:APIAccessAll` on the collection is admitted, and a role without it is refused. The policy still bounds what any admitted role may do to the collection's indexes. Naming roles one by one instead would state who has access twice, once in the grant and once in the policy.

A data access policy takes effect gradually: for a few minutes after it is created or changed, requests it admits can be refused with a bare `403 Forbidden`, and then succeed.

