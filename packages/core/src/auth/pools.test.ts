import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import {
    cognitoPoolDefinitions,
    cognitoPoolKey,
    poolAuthorizers,
    createPools,
    DEFAULT_POOL_ENV_KEY_NAME,
    DEFAULT_POOL_KEY,
    PoolsResult,
} from './pools'

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({
        id: `${args.name}-id`,
        state: { ...args.inputs, arn: `arn:${args.name}` },
    }),
    call: () => ({}),
})

/**
 * Creating a pool builds a pulumi resource, which `setMocks` above stands in for. `createPools` has
 * the same shape as `createQueues`: what it creates first, what it only references second.
 */
const reference = (envKeyName: string) => ({ id: `${envKeyName}-id`, arn: `arn:${envKeyName}`, envKeyName })

describe('createPools', () => {
    test('normalises a referenced pool into the shape a grant resolves against', () => {
        const pools = createPools('p', 'test', {}, undefined, { admin: reference('ADMIN_POOL_ID') })

        expect(pools.admin).toEqual({
            envKeyName: 'ADMIN_POOL_ID',
            ref: { id: 'ADMIN_POOL_ID-id', arn: 'arn:ADMIN_POOL_ID' },
            definition: reference('ADMIN_POOL_ID'),
        })
    })

    test('passes an already-resolved result item straight through', () => {
        const existing: PoolsResult = {
            admin: { envKeyName: 'A', ref: { id: 'i', arn: 'a' }, definition: reference('A') },
        }

        expect(createPools('p', 'test', {}, undefined, existing).admin).toBe(existing.admin)
    })

    test('is empty when the stack neither creates nor references one', () => {
        expect(createPools('p', 'test', {})).toEqual({})
    })

    test('authorizes with nothing when no pool is tagged for it', () => {
        expect(poolAuthorizers(createPools('p', 'test', {}, undefined, { admin: reference('A') }))).toEqual([])
    })

    test('creates a declared pool and publishes the env key it was given', () => {
        const pools = createPools('p', 'test', {}, { userPool: { envKeyName: 'COGNITO_USER_POOL_ID' } })

        expect(Object.keys(pools)).toEqual(['userPool'])
        expect(pools.userPool.awsPool).toBeDefined()
        expect(pools.userPool.envKeyName).toBe('COGNITO_USER_POOL_ID')
    })

    test('refuses to reference a pool under the name of one it created', () => {
        expect(() => createPools('p', 'test', {},
            { userPool: { envKeyName: 'A' } },
            { userPool: reference('B') },
        )).toThrow(/Cannot create a ref pool with the same name of an existing pool: userPool/)
    })

    test('creates every declared pool, so declaring one never drops another', () => {
        const pools = createPools('p', 'test', {}, {
            userPool: { envKeyName: 'COGNITO_USER_POOL_ID' },
            members: { envKeyName: 'MEMBERS_POOL_ID' },
        })

        expect(Object.values(pools).filter(x => x.awsPool)).toHaveLength(2)
    })
})

describe('poolAuthorizers', () => {
    test('carries every tagged pool, since the authorizer takes several provider ARNs', () => {
        const pools = createPools('p', 'test', {}, {
            admins: { envKeyName: 'ADMINS_POOL_ID', authorizer: true },
            customers: { envKeyName: 'CUSTOMERS_POOL_ID', authorizer: true },
        })

        expect(poolAuthorizers(pools)).toEqual([pools.admins.awsPool!, pools.customers.awsPool!])
    })

    test('leaves out a pool created only to be granted to functions', () => {
        // Creating a pool is not the same decision as exposing the API to it.
        const pools = createPools('p', 'test', {}, {
            logins: { envKeyName: 'LOGINS_POOL_ID', authorizer: true },
            partners: { envKeyName: 'PARTNERS_POOL_ID' },
        })

        expect(poolAuthorizers(pools)).toEqual([pools.logins.awsPool!])
    })

    test('lets a referenced pool authorize, by its arn', () => {
        const pools = createPools('p', 'test', {}, undefined, {
            admin: { ...reference('ADMIN_POOL_ID'), authorizer: true },
        })

        expect(poolAuthorizers(pools)).toEqual(['arn:ADMIN_POOL_ID'])
    })
})

describe('cognitoPoolKey', () => {
    test('names the pool auth.createCognito asks for, which is what the old outputs mean', () => {
        expect(cognitoPoolKey({ createCognito: true })).toBe(DEFAULT_POOL_KEY)
        expect(cognitoPoolKey({ createCognito: true, cognitoOptions: { key: 'members' } })).toBe('members')
    })

    test('names nothing when the stack does not ask for one, so the old outputs stay undefined', () => {
        expect(cognitoPoolKey({ createCognito: false })).toBeUndefined()
        expect(cognitoPoolKey(undefined)).toBeUndefined()
    })

    test('agrees with the key the definitions are built under', () => {
        // The one place the default lives: run() reads the old outputs from the same name.
        const auth = { createCognito: true, cognitoOptions: { key: 'members', envKeyName: 'M' } }

        expect(Object.keys(cognitoPoolDefinitions(auth) ?? {})).toEqual([cognitoPoolKey(auth)!])
    })

    test('resolves to a created pool, so the old outputs still point at it', () => {
        const auth = { createCognito: true }
        const pools = createPools('p', 'test', {}, cognitoPoolDefinitions(auth))

        expect(pools[cognitoPoolKey(auth)!].awsPool).toBeDefined()
    })
})

describe('cognitoPoolDefinitions', () => {
    test('maps the older switch onto a definition tagged to authorize', () => {
        expect(cognitoPoolDefinitions({ createCognito: true })).toEqual({
            [DEFAULT_POOL_KEY]: { envKeyName: DEFAULT_POOL_ENV_KEY_NAME, options: undefined, authorizer: true },
        })
    })

    test('takes the name and env var the stack chose for it', () => {
        const definitions = cognitoPoolDefinitions({
            createCognito: true,
            cognitoOptions: { key: 'members', envKeyName: 'MEMBERS_POOL_ID', useEmailAsUsername: true },
        })

        expect(Object.keys(definitions ?? {})).toEqual(['members'])
        expect(definitions?.members.envKeyName).toBe('MEMBERS_POOL_ID')
        expect(definitions?.members.options?.useEmailAsUsername).toBe(true)
    })

    test('defines nothing when the stack does not ask for a pool', () => {
        expect(cognitoPoolDefinitions({ createCognito: false })).toBeUndefined()
        expect(cognitoPoolDefinitions(undefined)).toBeUndefined()
    })

    test('merges with a declared pools record rather than being replaced by it', () => {
        // What run() does. `??` here would drop the cognito pool and delete it on the next deploy.
        const merged = { ...cognitoPoolDefinitions({ createCognito: true }), ...{ members: { envKeyName: 'M' } } }

        expect(Object.keys(merged).sort()).toEqual([DEFAULT_POOL_KEY, 'members'].sort())
    })

    test('an empty pools record does not drop it either, being merged and not nullish-checked', () => {
        const merged = { ...cognitoPoolDefinitions({ createCognito: true }), ...{} }

        expect(Object.keys(merged)).toEqual([DEFAULT_POOL_KEY])
    })
})
