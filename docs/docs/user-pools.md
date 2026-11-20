---
title: User pools
sidebar_label: User pools (Cognito)
slug: /user-pools
description: Create or reference Cognito user pools, authorize endpoints with them, and grant functions admin access.
---

A Cognito user pool does two separate jobs in a stack, and you opt into each one:

- **authorizing requests**: the API accepts the pool's tokens on the endpoints that select it. See [Authorizers](authorizers).
- **being administered by a function**: a function granted the pool may call Cognito's admin APIs on it.

## Declaring a pool

```ts
run('shop', environment, {
    pools: {
        customers: { name: 'shop-customers', envKeyName: 'CUSTOMERS_POOL_ID', options: { useEmailAsUsername: true } },
    },
    auth: {
        authorizers: { customer: { pool: 'customers' } },
        defaultAuthorizer: 'customer',
    },
    api: {
        endpointDefinitions: [
            { name: 'getProfile', path: '/me', method: 'GET', callbackDefinition: getProfile },
            {
                name: 'listCustomers', path: '/admin/customers', method: 'GET', callbackDefinition: listCustomers,
                resources: { pool: { customers: ['cognito-idp:ListUsers'] } },   // CUSTOMERS_POOL_ID = the pool id
            },
        ],
    },
})
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | The pool is named `<name>-<environment>`. The project isn't added. Renaming a pool replaces it, with its users. |
| `envKeyName` | yes | The variable a granted function reads the pool id from. |
| `options.useEmailAsUsername` | | Users sign in with their email address. |
| `options.preventResourceDeletion` | | Protects the pool from deletion. Defaults to `true`. |

Every pool lambada creates verifies email addresses, treats usernames case-insensitively, and requires passwords of at least 10 characters with upper case, lower case and a number. lambada creates no app clients or hosted domain: add them with Pulumi, using `run().pools.customers.awsPool`.

## Pools of another stack

`poolsRef` takes pools lambada didn't create in this stack:

```ts
poolsRef: {
    staff: { name: 'identity-staff', envKeyName: 'STAFF_POOL_ID' },                    // looked up as identity-staff-<environment>
    partners: { id: partnersPoolId, arn: partnersPoolArn, envKeyName: 'PARTNERS_POOL_ID' },
}
```

A lookup by name must find exactly one pool. A referenced pool is selected by authorizers and granted exactly like one the stack created.

## `auth.createCognito`

Older stacks create their pool with `auth.createCognito: true`. It is a pool like any other, declared under the key `userPool` (`cognitoOptions.key`) with the variable `COGNITO_USER_POOL_ID` (`cognitoOptions.envKeyName`), named `<project>-<environment>`:

```ts
auth: {
    createCognito: true,
    cognitoOptions: { preventResourceDeletion: true, useEmailAsUsername: true },
    authorizers: { user: { pool: 'userPool' } },
    defaultAuthorizer: 'user',
}
```

`run().auth` returns its `cognitoPoolId` and `cognitoARN`. New stacks should declare the pool under `pools`.

## Who is calling

An endpoint authorized by a pool receives the caller's claims, parsed into `user`:

```ts
import type { EmbroideryCallback } from '@lambada/core'

export const getProfile: EmbroideryCallback = async ({ user }) => ({
    id: user?.userId,          // sub
    email: user?.email,
    username: user?.username,
    poolId: user?.poolId,
})
```

`@lambada/utils` adds `isUserInGroup(user, 'admins')`, which reads the `cognito:groups` claim and falls back to Cognito. The fallback needs `cognito-idp:AdminListGroupsForUser`. There are also `getUser` and `getUserById`, which need `cognito-idp:AdminGetUser` and `cognito-idp:ListUsers`.
