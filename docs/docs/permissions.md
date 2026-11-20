---
title: Permissions and environment
sidebar_label: Permissions & environment
slug: /permissions
description: How a function is granted a resource by name, what IAM it receives, and which environment variables it sees.
---

Every function lambada builds starts with no access to anything but CloudWatch Logs. It reaches a table, a bucket, a topic or any other resource only by **granting** it under `resources`, by the name the resource is declared under in `run()`. The grant writes the IAM statement and publishes the resource's identifier to the function as an environment variable. The function never needs a hard-coded ARN or table name.

```ts
run('pets', environment, {
    tables: {
        pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS_TABLE' },
    },
    messages: {
        petAdopted: { name: 'pet-adopted', envKeyName: 'PET_ADOPTED_TOPIC' },
    },
    api: {
        endpointDefinitions: [{
            name: 'adoptPet',
            path: '/pets/{id}/adopt',
            method: 'POST',
            callbackDefinition: adoptPet,
            resources: {
                table: { pets: ['dynamodb:GetItem', 'dynamodb:UpdateItem'] },
                topic: { petAdopted: ['sns:Publish'] },
            },
        }],
    },
})
```

`adoptPet` may read and update items in `pets-<environment>` and publish to `pet-adopted-<environment>`, and nothing else. At runtime it reads `process.env.PETS_TABLE` and `process.env.PET_ADOPTED_TOPIC`.

## What each kind grants

`resources` takes one map per kind. Each key is a name declared in `run()`, and each value lists the IAM actions to allow.

| Kind | Declared under | Actions | IAM resource | Published as `envKeyName` |
| --- | --- | --- | --- | --- |
| `table` | `tables`, `tablesRef` | `dynamodb:*` | the table, plus `/index/*` when an index action is granted, plus the stream when a stream action is granted | table name |
| `bucket` | `buckets`, `bucketsRef` | `s3:*` | the bucket and `bucket/*`, or one prefix: see [Buckets](buckets) | bucket name, and the CDN domain if it has one |
| `topic` | `messages`, `messagesRef` | `sns:*` | the topic | topic ARN |
| `queue` | `queues`, `queuesRef` | `sqs:*` | the queue | queue URL |
| `secret` | `secrets`, `secretsRef` | `secretsmanager:*` | the secret | secret name |
| `kmsKey` | `keys`, `keysRef` | `kms:*` | the key | key ARN |
| `pool` | `pools`, `poolsRef`, `auth.createCognito` | `cognito-idp:*` | the user pool | pool id |
| `custom` | `customRef` | the service it declares | what it declares: see [Custom resources](custom-resources) | what it declares |
| `api` | `apisRef` | routes, such as `GET /api/users/{id}` | the routes' execute ARNs: see [Signed APIs](signed-apis) | the stage URL |
| `envVar` | `environmentVariables` | none: a list of names | none | the value |

Actions are IAM's own strings, and the type checks their service prefix. Case does not matter, as IAM ignores it. A wildcard such as `dynamodb:Get*` is accepted for the built-in kinds, but naming each action keeps the grant reviewable. A custom resource refuses wildcards outright.

:::tip Encrypted tables
A table encrypted with one of the stack's keys (`encryptionKeyName`) also gives its readers `kms:Decrypt` on that key, held to DynamoDB with `kms:ViaService` and to that table by its encryption context. You don't grant the key yourself.

Secrets and topics don't do this. A function reading a secret encrypted with your own key also needs `kmsKey: { <key>: ['kms:Decrypt'] }`.
:::

## Names are checked before any function is built

`run()` checks every name a declaration grants before it builds a single function. A misspelled name doesn't deploy a function that fails on its first call. The whole stack fails at `pulumi preview`, and every mistake is listed at once:

```text
Lambada found 3 resources that are granted but absent from the stack:

  getPet           table 'pet' — the stack has: pets, stores
  onStatusChanged  topic 'statusChangd' — the stack has: statusChanged
  markReady        environment variable 'STRIPE_KEYY' — the stack has: STRIPE_KEY

Correct the names, or add the resources to run().
```

This covers declarations written as plain objects. A declaration written as a [creator function](concepts#plain-declarations-and-creators) runs only while the stack is built, so its mistakes surface one at a time.

## Environment variables

A function's environment is assembled from four sources. Each later source wins over an earlier one:

1. `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`, always.
2. The `envKeyName` of every resource the function grants.
3. `globalEnvironmentVariables`: published to every function in the stack.
4. What the function picks from `environmentVariables`, then its own `environmentVariables`.

`environmentVariables` on `run()` is a **pool**: a function with a `resources` map sees an entry only by naming it under `resources.envVar`.

```ts
run('pets', environment, {
    globalEnvironmentVariables: { LOG_LEVEL: 'info' },
    environmentVariables: {
        STRIPE_KEY: stripeKey,                                  // set as STRIPE_KEY
        pageSize: { envKeyName: 'PAGE_SIZE', value: '50' },     // picked as pageSize, set as PAGE_SIZE
    },
    api: {
        endpointDefinitions: [{
            name: 'listPets', path: '/pets', method: 'GET', callbackDefinition: listPets,
            resources: { envVar: ['pageSize'] },
            environmentVariables: { FEATURE_FLAG: 'on' },        // only this function
        }],
    },
})
```

`listPets` sees `LOG_LEVEL`, `PAGE_SIZE` and `FEATURE_FLAG`, but not `STRIPE_KEY`.

- A function whose `resources` map has no `envVar` picks nothing from the pool.
- An endpoint that leaves `resources` out entirely, and a [webhook](webhooks)'s ingress function, receive the **whole** pool, as functions did before the pool existed. Give such an endpoint a `resources` map, even an empty `{}`, and it receives only what it picks.
- A pool entry is picked by its key, not by its `envKeyName`: `envVar: ['PAGE_SIZE']` above is reported as missing.
- One variable can't get two values. Two pool entries setting the same name, or a pool entry setting a name `globalEnvironmentVariables` already sets, is refused.
- Values may be Pulumi `Input`s. The record holding them may not, because lambada needs its keys before deployment.

:::note The older list form
`resources` also accepts the older array form, `[{ table: context.databases!.pets, access: ['dynamodb:Query'] }]`, inside a [creator](concepts#plain-declarations-and-creators). A function declared that way receives the **whole** pool, as it did before the pool existed, and its names aren't checked up front. Prefer the map.
:::

## Roles

Each function gets its own IAM role, named after the function in kebab case (`adoptPet` in `dev` becomes `adopt-pet-dev-role`), with one managed policy holding:

- `logs:CreateLogGroup`, `logs:CreateLogStream` and `logs:PutLogEvents`;
- one statement per grant, merged where actions and conditions match;
- EC2 network-interface actions when the function sets a `vpcConfig`;
- `AWSXRayDaemonWriteAccess`'s actions when it sets `enableXRay`.

**Functions with identical grants share a role.** Two functions with the same actions on the same resources, the same VPC setting and the same X-Ray flag share the role of the first one declared. Action order and case don't matter, but `dynamodb:Get*` and `dynamodb:GetItem` are different grants. A function with its own `policyStatements` always gets its own role.

The function is created only after its policy is attached, so the first invocation after a deploy already has its permissions.

A managed policy holds at most 6,144 characters. lambada merges statements before measuring, and a policy that is still too large fails at deploy with its size. Split the function, or grant fewer distinct resources.

### Extra statements

Subscriptions, queue handlers and schedules take `policyStatements` for IAM that no kind covers:

```ts
{
    name: 'rotateKeys',
    schedule: { every: { days: 1 } },
    callback: rotateKeys,
    resources: {},
    policyStatements: [{
        Effect: 'Allow',
        Action: ['iam:ListAccessKeys'],
        Resource: ['arn:aws:iam::123456789012:user/ci'],
    }],
}
```

Statements are added to the policy as written. Prefer a grant, or a [custom resource](custom-resources), where one fits: it is checked by name and shared by role.

## Granting a role lambada didn't build

`grant()` gives any IAM role the access a lambada function would get from the same `resources`: an ECS task, a hand-written Lambda, another tool's function.

```ts
import { run, grant } from '@lambada/core'

const stack = run('pets', environment, { tables, messages })

const workerRole = new aws.iam.Role('worker-role', { assumeRolePolicy: ecsTasksAssumeRole })

grant(stack, workerRole, 'worker', {
    table: { pets: ['dynamodb:GetItem', 'dynamodb:Query'] },
    topic: { petAdopted: ['sns:Publish'] },
})
```

It attaches an inline policy, Pulumi-named `worker-grants`, holding exactly the statements a lambada function would get, including the KMS statement of an encrypted table, but not the logs statement. It sets no environment variables, so `envVar` is refused: set them where that role's workload is built.

## Typed names

Action strings are typed per kind out of the box: `sns:Publish` on a table is a compile error. Resource names are typed when you pass the names you declared:

```ts
import type { LambadaEndpointArgs } from '@lambada/core'

const tables = { pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS_TABLE' } }
const environmentVariables = { STRIPE_KEY: stripeKey }

type Names = {
    table: keyof typeof tables
    envVar: keyof typeof environmentVariables
}

export const getPet = {
    name: 'getPet', path: '/pets/{id}', method: 'GET', callbackDefinition: handler,
    resources: { table: { pets: ['dynamodb:GetItem'] } },   // 'pet' would not compile
} satisfies LambadaEndpointArgs<Names>
```

`LambadaSubscriptionHandler<Names>`, `LambdaQueueHandler<Names>`, `LambdaSchedule<Names>` and `grant<Names>()` take the same parameter. Use `satisfies` rather than a type annotation where you can: it keeps the literal types the check needs.
