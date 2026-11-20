---
title: Tables
sidebar_label: Tables (DynamoDB)
slug: /tables
description: Declare DynamoDB tables with indexes, TTL, streams and encryption, and grant them by name.
---

A table is declared under `tables` by the name grants use. lambada creates it on demand capacity, tags it with the stack, and gives every granted function its physical name.

```ts
run('shop', environment, {
    tables: {
        orders: {
            name: 'orders',
            primaryKey: 'customerId',
            rangeKey: 'orderId',
            envKeyName: 'ORDERS_TABLE',
        },
    },
    api: {
        endpointDefinitions: [{
            name: 'listOrders', path: '/orders', method: 'GET', callbackDefinition: listOrders,
            resources: { table: { orders: ['dynamodb:Query'] } },   // ORDERS_TABLE = orders-dev
        }],
    },
})
```

## Declaring a table

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The table is named `<name>-<environment>`, or `<tablePrefix>-<name>-<environment>`. |
| `primaryKey` | yes | The partition key. Always a string (`S`). |
| `rangeKey` | | The sort key. Always a string (`S`). |
| `envKeyName` | yes | The variable a granted function reads the table name from. |
| `attributes` | | `{ name, type }` for every other attribute an index uses as a key: `type` is `'S'`, `'N'` or `'B'`. |
| `indexes` | | Global secondary indexes: see below. |
| `ttl` | | `{ attributeName, enabled }`. DynamoDB deletes items once that epoch-seconds attribute passes. |
| `encryptionKeyName` | | A key from `keys` or `keysRef` to encrypt the table with: see [Keys and secrets](keys-and-secrets). |
| `options` | | `pointInTimeRecoveryEnabled`, `deletionProtectionEnabled`, `streamEnabled`, `streamViewType`. |
| `data` | | Seed items, written when the table is created: see [Seed data](#seed-data). |

Every table is billed `PAY_PER_REQUEST`.

### Indexes

```ts
orders: {
    name: 'orders', primaryKey: 'customerId', rangeKey: 'orderId', envKeyName: 'ORDERS_TABLE',
    attributes: [{ name: 'status', type: 'S' }, { name: 'createdAt', type: 'N' }],
    indexes: [
        { name: 'byStatus', hashKey: 'status', rangeKey: 'createdAt', projectionType: 'ALL' },
    ],
}
```

An index is Pulumi's `aws.dynamodb.TableGlobalSecondaryIndex`. Declare every index key that isn't the table's own key under `attributes`, and nothing else: DynamoDB refuses attributes no key uses.

A function granted `dynamodb:Query` or `dynamodb:Scan` on the table may also use its indexes.

### Options for every table

`tableOptions` sets defaults that each table's own `options` override, and `tablePrefix` prefixes every table the stack creates:

```ts
run('shop', environment, {
    tablePrefix: 'shop',                                                 // shop-orders-dev
    tableOptions: { pointInTimeRecoveryEnabled: true, deletionProtectionEnabled: true },
    tables: {
        orders: { /* ... */ },
        sessions: { /* ... */, options: { deletionProtectionEnabled: false } },
    },
})
```

:::tip Protect production data
Turn on `deletionProtectionEnabled` and `pointInTimeRecoveryEnabled` for any environment whose data you'd miss. A renamed table is a replaced table, with an empty one in its place.
:::

### Streams

`options: { streamEnabled: true, streamViewType: 'NEW_AND_OLD_IMAGES' }` turns on the table's stream. A function granted stream actions (`dynamodb:GetRecords`, `dynamodb:GetShardIterator`, `dynamodb:DescribeStream`) is granted the stream as well. lambada has no declaration that triggers a function from a stream: wire one with Pulumi.

## Tables of another stack

`tablesRef` takes tables another stack created. Pass that stack's `run().databases` in the same program, or a definition, which is looked up by its full name in **this** stack's environment:

```ts
run('billing', environment, {
    tablesRef: {
        orders: {
            name: 'shop-orders',             // the other stack's prefix and name: shop-orders-<environment>
            primaryKey: 'customerId',
            rangeKey: 'orderId',
            envKeyName: 'ORDERS_TABLE',
            indexes: [{ name: 'byStatus', hashKey: 'status', projectionType: 'ALL' }],
        },
    },
})
```

`tablePrefix` doesn't apply to references. The grant is decided from the definition, not from the live table: list a referenced table's `indexes` for index grants, and set `options.streamEnabled` for stream grants.

## Reading a table

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { EmbroideryCallback } from '@lambada/core'

let client: DynamoDBDocumentClient | undefined
const db = () => client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}))   // see Function options

export const listOrders: EmbroideryCallback = async ({ user }) => {
    const { Items } = await db().send(new QueryCommand({
        TableName: process.env.ORDERS_TABLE,
        KeyConditionExpression: 'customerId = :c',
        ExpressionAttributeValues: { ':c': user?.userId },
    }))
    return { items: Items ?? [] }
}
```

`@lambada/utils` also has a small repository base class: see [`RepositoryBase`](reference/utils#repositories).

## Seed data

`data` lists items to write when the stack is deployed: objects, which lambada marshals, or DynamoDB-JSON strings.

```ts
countries: {
    name: 'countries', primaryKey: 'code', envKeyName: 'COUNTRIES_TABLE',
    data: [{ code: 'ES', name: 'Spain' }, { code: 'AR', name: 'Argentina' }],
}
```

Each item becomes a Pulumi resource, so seed reference data, not data your application changes. Seeding a table with a `rangeKey` isn't supported.
