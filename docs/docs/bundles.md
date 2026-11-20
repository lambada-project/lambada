---
title: Bundles
sidebar_label: Bundles
slug: /bundles
description: Deploy functions from artifacts your own build produced, instead of Pulumi-serialized closures.
---

By default lambada deploys a function by **serializing its callback**: Pulumi captures the closure and everything it references and uploads it as the function's code. That needs no build step, and it is how the [Quickstart](quickstart) works.

A **bundle** is the alternative: a folder your own build wrote (esbuild, tsup, bun build…), deployed as is. Reach for it when:

- the serialized closure grows large, or captures something it shouldn't;
- you want `pulumi preview` to do no code work, and the upload to be reproducible from a CI artifact;
- you build with a bundler for tree-shaking, minification or native dependencies.

## A bundle is a folder and a handler

```ts
import type { LambdaFolder } from '@lambada/core'

const getPet: LambdaFolder = {
    functionFolder: 'dist/functions/getPet',   // zipped as is
    handler: 'index.handler',                  // <file>.<export>
}
```

## Name the bundles in `run()`

`bundles` maps function names to folders. Every declaration whose name it lists is deployed from its folder. The rest keep their serialized closure, so you can move one function at a time.

```ts
run('pets', environment, {
    bundles: {
        getPet: { functionFolder: 'dist/functions/getPet', handler: 'index.handler' },
        sweep: { functionFolder: 'dist/functions/sweep', handler: 'index.handler' },
    },
    api: {
        endpointDefinitions: [
            { name: 'getPet', path: '/pets/{id}', method: 'GET', callbackDefinition: getPet,
              resources: { table: { pets: ['dynamodb:GetItem'] } } },
        ],
    },
    scheduleDefinitions: [
        { name: 'sweep', schedule: { every: { hours: 1 } }, callback: sweep, resources: {} },
    ],
})
```

`bundles` can also be a function, `(name) => LambdaFolder | undefined`, to read a manifest your build wrote:

```ts
import manifestJson from './dist/functions/manifest.json'

const manifest: Record<string, unknown> = manifestJson

run('pets', environment, {
    bundles: name => name in manifest
        ? { functionFolder: `dist/functions/${name}`, handler: 'index.handler' }
        : undefined,
    // ...
})
```

The function name is the declaration's `name`. For an endpoint without one, it's the derived name, such as `pets-pets-id-get`.

## Or per declaration

A single declaration can point at its own folder, and that wins over `bundles`:

- an endpoint takes `useBundle: { functionFolder, handler }`, and keeps `callbackDefinition`, which it falls back to when no bundle is given;
- a subscription, queue handler or schedule takes the folder as its `callback`.

Grants, environment variables, options and logs apply exactly as they do to a closure.

## Endpoint bundles wrap themselves

A serialized endpoint is wrapped by lambada: the wrapper parses the auth context, adds CORS headers and turns thrown errors into responses (see [HTTP API](http-api#what-a-handler-returns)). A bundle has no closure to carry that wrapper, so it wraps its own handler with `createHandler` from `@lambada/utils`. lambada passes the wrapper's settings as environment variables, and `wrapperConfigFromEnv()` reads them back:

```ts title="src/functions/getPet/index.ts"
import { createHandler, wrapperConfigFromEnv } from '@lambada/utils/handler'
import { getPet } from '../../api/pets'

export const handler = createHandler(getPet, wrapperConfigFromEnv())
```

`@lambada/utils` has no Pulumi dependency, so it stays small in a bundle. Import from `@lambada/utils/handler` rather than the package root, which also loads the Cognito client.

Subscriptions, queue handlers and schedules need no wrapper: their handler receives the raw event.

:::note Webhooks
A [webhook](webhooks)'s queue function is lambada's own code, not yours, so it is never bundled, and `useBundle` on a webhook is ignored.
:::
