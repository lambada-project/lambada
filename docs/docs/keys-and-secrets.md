---
title: Keys and secrets
sidebar_label: Keys & secrets
slug: /keys-and-secrets
description: Create KMS keys and Secrets Manager secrets, encrypt tables, topics and secrets with them, and grant them by name.
---

## KMS keys

A key is declared under `keys` by the name tables, topics, secrets and grants use:

```ts
run('shop', environment, {
    keys: {
        data: { name: 'data', envKeyName: 'DATA_KEY_ARN' },   // alias/shop-data-<environment>
    },
    tables: {
        orders: { name: 'orders', primaryKey: 'id', envKeyName: 'ORDERS_TABLE', encryptionKeyName: 'data' },
    },
    messages: {
        orderPlaced: { name: 'order-placed', envKeyName: 'ORDER_PLACED_TOPIC', encryptionKeyName: 'data' },
    },
})
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The key gets the alias `alias/<project>-<name>-<environment>`. |
| `envKeyName` | yes | The variable a granted function reads the key ARN from. |
| `options` | | Pulumi `aws.kms.KeyArgs`, such as `enableKeyRotation`. |

A key is scheduled for deletion with a 30-day window when it is removed from the stack.

### What a key encrypts

- **A table** with `encryptionKeyName` uses it for server-side encryption. Every function granted the table can decrypt through DynamoDB, without a key grant of its own.
- **A topic** with `encryptionKeyName` uses it for SNS encryption. Publishers need a `kmsKey` grant: `['kms:GenerateDataKey', 'kms:Decrypt']`.
- **A secret** with `encryptionKeyName` uses it instead of the AWS-managed key. Readers need `kmsKey: { data: ['kms:Decrypt'] }`.

A name that isn't in `keys` or `keysRef` is reported with the stack's other missing resources.

:::note The `dynamodb` key
Older stacks declare a key under `keys.dynamodb`, which encrypts every table that names no `encryptionKeyName`. That still works and logs a warning. Set `encryptionKeyName: 'dynamodb'` on those tables to keep their key when the fallback goes away.
:::

### Using a key directly

```ts
resources: { kmsKey: { data: ['kms:Encrypt', 'kms:Decrypt'] } }   // DATA_KEY_ARN = the key ARN
```

### Keys of another stack

`keysRef` takes keys another stack created:

```ts
keysRef: {
    shared: { name: 'platform-data', envKeyName: 'SHARED_KEY_ARN' },                 // alias/platform-data-<environment>
    legacy: { id: 'arn:aws:kms:eu-west-1:123456789012:key/…', envKeyName: 'LEGACY_KEY_ARN' },
}
```

A definition is looked up by alias. Its `name` spells the owning project's prefix, because the referencing stack's project isn't added. `{ id }` takes any key by id or ARN. Another stack's `run().security` entries can be passed as they are.

## Secrets

A secret is declared under `secrets`. lambada creates the secret, not its value: set the value with the AWS console or CLI, or with Pulumi's `aws.secretsmanager.SecretVersion`.

```ts
run('shop', environment, {
    keys: { data: { name: 'data', envKeyName: 'DATA_KEY_ARN' } },
    secrets: {
        stripe: { name: 'stripe', envKeyName: 'STRIPE_SECRET', encryptionKeyName: 'data' },   // shop-stripe-<environment>
    },
    api: {
        endpointDefinitions: [{
            name: 'charge', path: '/charges', method: 'POST', callbackDefinition: charge,
            resources: {
                secret: { stripe: ['secretsmanager:GetSecretValue'] },   // STRIPE_SECRET = the secret name
                kmsKey: { data: ['kms:Decrypt'] },
            },
        }],
    },
})
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The secret is named `<project>-<name>-<environment>`. |
| `envKeyName` | yes | The variable a granted function reads the secret **name** from. |
| `encryptionKeyName` | | A key from `keys` or `keysRef`. Left out, Secrets Manager's AWS-managed key is used. |

Read it at runtime with `SecretsManagerCache` from `@lambada/utils`, which caches each value for five minutes:

```ts
import { SecretsManagerCache } from '@lambada/utils/dist/secretManager'

const { apiKey } = await SecretsManagerCache.get().getSecret(process.env.STRIPE_SECRET!, true) as any
```

`secretsRef` takes secrets another stack created: a definition is looked up as `<name>-<environment>`, with the owning project's prefix in `name`.

:::caution
An `encryptionKeyName` on a secret that names no key is silently ignored, and the secret uses the AWS-managed key. Tables and topics report the same mistake.
:::

### Values that aren't secret

Configuration that doesn't need Secrets Manager belongs in the stack's [`environmentVariables`](permissions#environment-variables) pool. Values from Pulumi config secrets (`config.requireSecret(...)`) stay encrypted in the state, but they are visible as plain text in the function's configuration.
