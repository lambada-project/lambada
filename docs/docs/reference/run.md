---
title: run()
sidebar_label: run()
slug: /reference/run
description: Every argument run() takes and every field it returns.
---

```ts
import { run, type LambadaRunArguments } from '@lambada/core'

const result = run(projectName: string, environment: string, args: LambadaRunArguments)
```

- `projectName` names the stack: tags, the resource group, keys, secrets and log groups carry it.
- `environment` names one deployment of it: most resources are named `<name>-<environment>`. Pass `pulumi.getStack()`.
- `args` is described below, grouped by what each field declares. Every field is optional.

## Resources

| Field | Declares | Guide |
| --- | --- | --- |
| `tables` | DynamoDB tables, by key | [Tables](../tables) |
| `tablesRef` | Tables of another stack | [Tables](../tables#tables-of-another-stack) |
| `tablePrefix` | A prefix for every table this stack creates | [Tables](../tables#options-for-every-table) |
| `tableOptions` | Defaults for every table's `options` | [Tables](../tables#options-for-every-table) |
| `buckets` | S3 buckets, with prefixes and an optional CloudFront distribution | [Buckets](../buckets) |
| `bucketsRef` | Buckets of another stack | [Buckets](../buckets) |
| `messages` | SNS topics | [Topics](../topics) |
| `messagesRef` | Topics of another stack | [Topics](../topics#topics-of-another-stack) |
| `queues` | SQS queues | [Queues](../queues) |
| `queuesRef` | Queues of another stack | [Queues](../queues#queues-of-another-stack) |
| `keys` | KMS keys | [Keys and secrets](../keys-and-secrets) |
| `keysRef` | Keys of another stack | [Keys and secrets](../keys-and-secrets#keys-of-another-stack) |
| `secrets` | Secrets Manager secrets | [Keys and secrets](../keys-and-secrets#secrets) |
| `secretsRef` | Secrets of another stack | [Keys and secrets](../keys-and-secrets#secrets) |
| `pools` | Cognito user pools | [User pools](../user-pools) |
| `poolsRef` | Pools of another stack | [User pools](../user-pools#pools-of-another-stack) |
| `customRef` | Resources of a kind lambada doesn't have | [Custom resources](../custom-resources) |
| `apisRef` | Signed APIs of other stacks | [Signed APIs](../signed-apis) |
| `environmentVariables` | The pool functions pick variables from with `resources.envVar` | [Permissions](../permissions#environment-variables) |
| `globalEnvironmentVariables` | Variables every function receives | [Permissions](../permissions#environment-variables) |

## Functions

| Field | Declares | Guide |
| --- | --- | --- |
| `api.endpointDefinitions` | HTTP endpoints, proxies and webhooks | [HTTP API](../http-api) |
| `messageHandlerDefinitions` | Functions subscribed to topics | [Topics](../topics#subscribing-a-function) |
| `queueHandlerDefinitions` | Functions processing queues | [Queues](../queues#handling) |
| `scheduleDefinitions` | Functions on a rate or a cron | [Schedules](../schedules) |
| `api.lambdaDefaultOptions` | Default `lambdaOptions` for **every** function | [Function options](../functions) |
| `bundles` | Pre-built code by function name | [Bundles](../bundles) |
| `logs` | Log groups lambada owns, and their retention | [Function options](../functions#logs) |

Every function declaration shares these fields:

| Field | Description |
| --- | --- |
| `name` | Names the function, its role and its log group. |
| `resources` | What it is granted: `{ table: { key: [actions] }, …, envVar: [names] }`. |
| `environmentVariables` | Its own variables, which win over everything else. |
| `lambdaOptions` | `memorySize`, `timeout`, `runtime`, `architecture`, `vpcConfig`, `layers`, `reservedConcurrentExecutions`, `enableXRay`, `logRetention`. |

## API

| Field | Default | Description | Guide |
| --- | --- | --- | --- |
| `api.gatewayType` | `'EDGE'` | `'EDGE'`, `'REGIONAL'` or `'PRIVATE'` | [HTTP API](../http-api#the-gateway) |
| `api.vpcEndpointIds` | | VPC endpoints of a private API | [HTTP API](../http-api#the-gateway) |
| `api.policy` | | The API's resource policy, as JSON | [HTTP API](../http-api#the-gateway) |
| `api.stage` | `{ name: 'app' }` | Stage `name` and `variables` | [HTTP API](../http-api#the-gateway) |
| `api.openAPIDocument` | | Publishes `GET /api/openapi` | [HTTP API](../http-api#openapi) |
| `auth.authorizers` | | Authorizers by name | [Authorizers](../authorizers) |
| `auth.defaultAuthorizer` | | What an endpoint runs when it selects none | [Authorizers](../authorizers) |
| `auth.useApiKey` | | Requires an API key: `{ name?, openapi? }` | [HTTP API](../http-api#api-keys) |
| `auth.createCognito`, `auth.cognitoOptions` | | Creates the stack's legacy pool | [User pools](../user-pools#authcreatecognito) |
| `cors` | | `{ origins, headers }` | [HTTP API](../http-api#cors) |
| `staticSiteLocalPath` | | A folder served under `/www` | [Static sites](../static-sites) |
| `cdn` | | CloudFront in front of the API and site | [Static sites](../static-sites#the-distribution) |
| `naming.apiPath` | `'/api'` | The prefix of every route | [HTTP API](../http-api#the-gateway) |
| `naming.wwwPath` | `'/www'` | Where the static site is served | [Static sites](../static-sites) |
| `naming.stageName` | `'app'` | The stage the CDN reads from | [Static sites](../static-sites#options) |
| `options.dependsOn` | | Resources the API waits for | |

`auth.lambdaAuthorizers`, `auth.authorizerPools` and `auth.extraAuthorizers` are deprecated: see [moving from the deprecated fields](../authorizers#moving-from-the-deprecated-fields).

## Stack

| Field | Default | Description |
| --- | --- | --- |
| `resourceGroups.skipCreate` | `false` | Skips the resource group. |
| `resourceGroups.name` | `<project>-<environment>` | Names the resource group. |
| `notifications.GCMCredential` | | Creates an SNS platform application for Firebase Cloud Messaging. |

## What run() returns

| Field | Type | Holds |
| --- | --- | --- |
| `api` | `awsx.apigateway.API \| undefined` | The API, if the stack declares endpoints. `api.url` is the stage URL, and routes are under `api/`. |
| `cdn` | `aws.cloudfront.Distribution \| undefined` | The distribution, with `cdn: { useCDN: true }`. |
| `signedApi` | `Output<SignedApi> \| undefined` | The API's signed routes, for another stack's `apisRef`. |
| `apiKey` | `AssociatedAPIKeys \| undefined` | With `auth.useApiKey`: `apiKey.keys[0].apikey.value`. |
| `databases` | `DatabaseResult` | Tables by key: `awsTable`, `ref`, `definition`. |
| `buckets` | `BucketsResult` | Buckets by key. |
| `messaging` | `MessagingResult` | Topics by key: `awsTopic`, `ref`. |
| `queues` | `QueuesResult` | Queues by key: `awsQueue`, `ref`. |
| `pools` | `PoolsResult` | User pools by key: `awsPool`, `ref`. |
| `secrets` | `SecretsResult` | Secrets by key. |
| `security` | `SecurityResult` | KMS keys by key. |
| `custom` | `CustomResult` | `customRef`'s resources. |
| `apis` | `ApisResult` | `apisRef`'s APIs. |
| `auth` | `{ cognitoPoolId, cognitoARN }` | The pool of `auth.createCognito`, if any. |

Each result can be passed to the matching `…Ref` argument of another `run()` in the same program, and to [`grant()`](../permissions#granting-a-role-lambada-didnt-build):

```ts
const shop = run('shop', environment, { tables, messages })

run('billing', environment, {
    tablesRef: shop.databases,
    messagesRef: shop.messaging,
    messageHandlerDefinitions: [ /* ... */ ],
})

export const apiUrl = shop.api?.url
export const ordersTable = shop.databases.orders.ref.name
```

## Other exports

| Export | Description |
| --- | --- |
| `grant(stack, role, name, resources)` | Grants a role lambada didn't build: see [Permissions](../permissions#granting-a-role-lambada-didnt-build). |
| `scheduleExpression(name, schedule)` | The EventBridge expression a schedule becomes. |
| `ConfigureAwsEnvironment`, `RemoveResources` | Test setup: see [Testing](../testing). |
| `getMockRequest(authenticated, body?, query?)` | An API Gateway event for unit tests. |
| `createEndpoint`, `createEndpointSimple`, `createEndpointSimpleCors`, `createProxyIntegration` | Lower-level route builders, for [creators](../concepts#plain-declarations-and-creators). |
| Types | `LambadaRunArguments`, `LambadaEndpointArgs`, `LambadaSubscriptionHandler`, `LambdaQueueHandler`, `LambdaSchedule`, `EmbroideryCallback`, `SubscriptionCallback`, `QueueHandlerCallback`, `ScheduleCallback`, `LambdaFolder`, `LambadaGrants`, `AttributePolicy`, `BodyPolicy`, `Schedule`, `Cron`… |
