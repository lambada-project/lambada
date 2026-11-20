---
id: migration-guide
title: Migration guide
sidebar_label: Migration guide
slug: /migration
description: Move older stacks to declarative grants, named authorizers and current options, and from Attire to Lambada.
---

Older APIs keep working. Each section below shows what replaces one and what changes in a deployed stack when you switch.

## Grant lists to grant maps

Older declarations reach resources through a [creator](concepts#plain-declarations-and-creators) and a list of grants:

```ts
// Before
(context) => ({
    name: 'listTodos', path: '/todos', method: 'GET', callbackDefinition: listTodos,
    resources: [
        { table: context.databases?.todos, access: [LambdaResourceAccess.DynamoDbQuery] },
        { topic: context.messaging?.todoCreated, access: [LambdaResourceAccess.SNSPublish] },
    ],
})
```

```ts
// After
{
    name: 'listTodos', path: '/todos', method: 'GET', callbackDefinition: listTodos,
    resources: {
        table: { todos: ['dynamodb:Query'] },
        topic: { todoCreated: ['sns:Publish'] },
    },
}
```

What you gain:

- the names are checked before any function is built, with every mistake listed at once, instead of a deploy-time failure;
- actions are typed by service;
- the function sees only the [`environmentVariables`](permissions#environment-variables) it picks with `envVar`.

What to check: a function moving from a list to a map **stops receiving the whole `environmentVariables` pool**. List the variables it reads under `resources.envVar`, or move them to `globalEnvironmentVariables`.

A map grants the same IAM statements as the list it replaces. Keep the endpoint's `name`, or leave it out if it had none, so the function keeps its name and isn't replaced. Run `pulumi preview` and check that the only changes are to environment variables.

## `options` to `lambdaOptions`

An endpoint's `options` is now `lambdaOptions`, the name every other function kind uses. They deploy identically. Set one, not both.

## Authorizers

`auth.lambdaAuthorizers`, `auth.authorizerPools`, `auth.extraAuthorizers` and the per-endpoint `useCognitoAuthorizer`, `lambdaAuthorizer` and `enableAuth` are replaced by authorizers declared by name. See [Moving from the deprecated fields](authorizers#moving-from-the-deprecated-fields).

## Keys for tables

A table without an `encryptionKeyName` is encrypted with the key declared as `keys.dynamodb`, if there is one, and the deploy logs a warning. Set `encryptionKeyName: 'dynamodb'` on those tables to keep their encryption once the fallback is removed.

## From Attire to Lambada (March 2021)

The breaking changes were kept to a minimum. Rename `@attire` to `@lambada`, then:

- **Core library is now `@lambada/core`.**
- **`EmbroideryContext` is renamed `LambadaResources`.** Replace one with the other. Types such as `EmbroideryCallback` and `EmbroideryRequest` keep their names.
- **Runtime helpers moved from `@attire/core/dist/lib/api/utils` to `@lambada/utils`.** Shipping them in the core library made Pulumi bundle it into every function. `@lambada/utils` is light, with no runtime dependencies besides the AWS SDK.
