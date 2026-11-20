---
title: Function options
sidebar_label: Function options
slug: /functions
description: Memory, timeout, runtime, architecture, VPC, layers, X-Ray and log retention for every function lambada builds.
---

Every function lambada builds is tuned by the same `LambdaOptions`, whatever triggers it: an endpoint, a subscription, a queue handler or a schedule. Set stack-wide defaults once, and override them per function.

```ts
run('pets', environment, {
    api: {
        // Defaults for every function in the stack, not only endpoints.
        lambdaDefaultOptions: { memorySize: 256, timeout: 30, architecture: 'arm64' },
        endpointDefinitions: [{
            name: 'exportPets', path: '/pets/export', method: 'POST', callbackDefinition: exportPets,
            resources: { table: { pets: ['dynamodb:Query'] } },
            lambdaOptions: { memorySize: 1024, timeout: 120 },   // wins over the defaults
        }],
    },
    scheduleDefinitions: [{
        name: 'sweep', schedule: { every: { hours: 1 } }, callback: sweep, resources: {},
        lambdaOptions: { reservedConcurrentExecutions: 1 },
    }],
})
```

:::info `lambdaDefaultOptions` applies to every function
It lives under `api`, but subscriptions, queue handlers, schedules and webhooks inherit it too. The exception is a webhook's `timeout`, which defaults to 30 seconds unless the webhook sets its own.
:::

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `memorySize` | `512` | Memory in MB. CPU scales with it. |
| `timeout` | `90` | Timeout in **seconds**. API Gateway still cuts an HTTP request off at 29 seconds. |
| `runtime` | `nodejs24.x` | Any `aws.lambda.Runtime`. |
| `architecture` | AWS's default, `x86_64` | `'arm64'` for Graviton: usually cheaper per millisecond. |
| `reservedConcurrentExecutions` | `-1`, unreserved | Caps concurrency. `0` stops the function from being invoked. |
| `vpcConfig` | none | `{ subnetIds, securityGroupIds }`. Adds the EC2 network-interface permissions the function needs. |
| `layers` | none | Layer version ARNs. |
| `enableXRay` | `false` | Grants the X-Ray daemon write permissions. |
| `logRetention` | none | `{ days }`. Read only when the stack declares [`logs`](#logs). |
| `callbackWaitsForEmptyEventLoop` | | Deprecated: only endpoints read it, and only on Node 22 or older. |

Options merge key by key: a function's own value wins, then `lambdaDefaultOptions`. An object such as `vpcConfig` is replaced whole, not merged.

On an endpoint, `options` is the older name of `lambdaOptions`. Set one of them: a declaration setting both is refused.

:::caution X-Ray
`enableXRay` grants the permissions only. It does not switch on active tracing.
:::

## Logs

By default every function writes to the log group Lambda creates for it, `/aws/lambda/<function>`, and its logs never expire. Declare `logs` on `run()` to have lambada own the log groups instead:

```ts
run('pets', environment, {
    logs: { retention: { days: 30 } },
    api: {
        endpointDefinitions: [{
            name: 'getPet', path: '/pets/{id}', method: 'GET', callbackDefinition: getPet,
            resources: { table: { pets: ['dynamodb:GetItem'] } },
            lambdaOptions: { logRetention: { days: 365 } },
        }],
    },
})
```

- Every function gets a log group named `/lambada/<project>/<function>-<environment>`, such as `/lambada/pets/getPet-dev`. It carries the stack's tags, except for queue handlers, webhook handlers and the CORS function.
- Retention is the function's `logRetention`, else `logs.retention`. With neither, logs never expire.
- `days` is one of the values CloudWatch accepts: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288 or 3653.

Without `logs`, `logRetention` is ignored.

## Naming

A function's Pulumi name is `<name>-<environment>`, and Pulumi gives the AWS function a unique physical name from it. An endpoint without a `name` is named after its project, path and method: `pets` `GET /pets/{id}` becomes `pets-pets-id-get`. Give endpoints a `name`: it names the function, its role and its log group, and renaming one replaces them.

## What a handler captures

By default lambada deploys a function by serializing its callback with Pulumi's [function serialization](https://www.pulumi.com/docs/iac/concepts/functions/function-serialization/). Pulumi walks everything the callback references and writes it into the function's code:

- **Modules** from `node_modules` are captured as `require(...)` calls. Every package under `dependencies` in `package.json`, with its own dependencies, is uploaded with **each** function. `@pulumi/*` packages are left out, and so is everything under `devDependencies`. Keep `@lambada/core` and other deploy-time packages in `devDependencies`, and only what handlers use in `dependencies`.
- **Plain values** (strings, numbers, plain objects) are captured as they are when the stack is deployed.
- **Live objects** can't be captured. That includes an AWS SDK client, an open connection, or anything holding a native function. `pulumi up` fails with `Error serializing … it was a native code function`, followed by the chain of references that reached it.

So create clients on first use, inside the function, and keep them in a variable for warm invocations:

```ts
import { SQSClient } from '@aws-sdk/client-sqs'

let client: SQSClient | undefined
const sqs = () => client ??= new SQSClient({})

export const handler = async () => {
    await sqs().send(/* ... */)
}
```

Don't read configuration at the top of a module either. `process.env.ORDERS_TABLE` read at module level is evaluated on the machine running `pulumi up`, not in Lambda. Read it inside the handler.

:::tip Avoiding serialization altogether
If serialization gets in the way, or the captured code grows large, build the functions yourself and deploy them as [bundles](bundles).
:::
