import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import {
    createPools,
    onlyPool,
    DEFAULT_POOL_ENV_KEY_NAME,
    DEFAULT_POOL_KEY,
    PoolsResult,
} from './pools'

/** What the engine was asked to build, so a name collision is visible here and not at deploy. */
const built: string[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push(args.name)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:cognito/getUserPools:getUserPools') {
            const name = args.inputs.name as string
            const count = name.startsWith('twins') ? 2 : name.startsWith('ghost') ? 0 : 1

            return {
                name,
                ids: Array.from({ length: count }, (_, i) => `${name}-id-${i}`),
                arns: Array.from({ length: count }, (_, i) => `arn:${name}-${i}`),
            }
        }
        return {}
    },
})

const settled = <T>(o: pulumi.Output<T>): Promise<T> => (o as unknown as { promise(): Promise<T> }).promise()
const namesBuiltBy = async (pools: PoolsResult) => {
    built.length = 0
    await Promise.all(Object.values(pools).map(p => settled(pulumi.output(p.ref.id))))
    return built.slice()
}

const reference = (envKeyName: string) => ({ id: `${envKeyName}-id`, arn: `arn:${envKeyName}`, envKeyName })
const create = (
    auth?: Parameters<typeof createPools>[3],
    pools?: Parameters<typeof createPools>[4],
    poolsRef?: Parameters<typeof createPools>[5],
) => createPools('proj', 'test', {}, auth, pools, poolsRef)

describe('createPools', () => {
    test('is empty when the stack neither creates nor references one', () => {
        expect(create().pools).toEqual({})
    })

    test('normalises a referenced pool into the shape a grant resolves against', () => {
        expect(create(undefined, undefined, { admin: reference('ADMIN_POOL_ID') }).pools.admin).toEqual({
            envKeyName: 'ADMIN_POOL_ID',
            ref: { id: 'ADMIN_POOL_ID-id', arn: 'arn:ADMIN_POOL_ID' },
            definition: reference('ADMIN_POOL_ID'),
        })
    })

    test('passes an already-resolved result item straight through', () => {
        const existing: PoolsResult = {
            admin: { envKeyName: 'A', ref: { id: 'i', arn: 'a' }, definition: reference('A') },
        }

        expect(create(undefined, undefined, existing).pools.admin).toBe(existing.admin)
    })

    test('creates a declared pool and publishes the env key it was given', () => {
        const { pools } = create(undefined, { userPool: { name: 'userPool', envKeyName: 'COGNITO_USER_POOL_ID' } })

        expect(pools.userPool.awsPool).toBeDefined()
        expect(pools.userPool.envKeyName).toBe('COGNITO_USER_POOL_ID')
    })

    test('resolves a ref given by name through the pool name', async () => {
        const { pools } = create(undefined, undefined, { partners: { name: 'partners', envKeyName: 'PARTNERS_POOL_ID' } })

        expect(pools.partners.awsPool).toBeUndefined()
        expect(await settled(pulumi.output(pools.partners.ref.arn))).toBe('arn:partners-test-0')
        expect(await settled(pulumi.output(pools.partners.ref.id))).toBe('partners-test-id-0')
    })

    test('both ref forms sit in one record', async () => {
        const { pools } = create(undefined, undefined, {
            partners: { name: 'partners', envKeyName: 'PARTNERS_POOL_ID' },
            outside: reference('OUTSIDE_POOL_ID'),
        })

        expect(Object.keys(pools).sort()).toEqual(['outside', 'partners'])
        expect(await settled(pulumi.output(pools.partners.ref.arn))).toBe('arn:partners-test-0')
        expect(await settled(pulumi.output(pools.outside.ref.arn))).toBe('arn:OUTSIDE_POOL_ID')
    })

    test('refuses to reference a pool under the name of one it created', () => {
        expect(() => create(undefined, { userPool: { name: 'userPool', envKeyName: 'A' } }, { userPool: reference('B') }))
            .toThrow(/Cannot create a ref pool with the same name of an existing pool: userPool/)
    })
})

describe('what each created pool is called', () => {
    test('two pools are two resources, not one declared twice', async () => {
        // createUserPool used to name every pool `${projectName}-${environment}`, so a second
        // declaration was the same resource again and the engine refused the stack.
        const { pools } = create(undefined, {
            admins: { name: 'admins', envKeyName: 'A' },
            members: { name: 'members', envKeyName: 'M' },
        })

        expect(await namesBuiltBy(pools)).toEqual(['admins-test', 'members-test'])
    })

    test('the pool auth.createCognito builds keeps the name it always had', async () => {
        // A renamed pool is a replaced pool, and a replaced user pool takes its users with it.
        const { pools } = create({ createCognito: true })

        expect(await namesBuiltBy(pools)).toEqual(['proj-test'])
    })

    test('refuses two pools of one name rather than leaving it to the engine', () => {
        expect(() => create(undefined, {
            admins: { name: 'shared', envKeyName: 'A' },
            members: { name: 'shared', envKeyName: 'M' },
        })).toThrow(/Cannot create two pools named shared: members repeats it/)
    })
})

describe('the pool auth.createCognito asks for', () => {
    test('goes under the default key', () => {
        const { pools } = create({ createCognito: true })

        expect(pools[DEFAULT_POOL_KEY].envKeyName).toBe(DEFAULT_POOL_ENV_KEY_NAME)
    })

    test('takes the key and env var the stack chose for it', () => {
        const { pools, auth } = create({
            createCognito: true,
            cognitoOptions: { key: 'members', envKeyName: 'MEMBERS_POOL_ID', useEmailAsUsername: true },
        })

        expect(Object.keys(pools)).toEqual(['members'])
        expect(pools.members.envKeyName).toBe('MEMBERS_POOL_ID')
        expect(auth.cognitoARN).toBeDefined()
    })

    test('sits alongside a pool the stack declares itself', () => {
        const { pools } = create({ createCognito: true }, { members: { name: 'members', envKeyName: 'M' } })

        expect(Object.keys(pools).sort()).toEqual([DEFAULT_POOL_KEY, 'members'].sort())
    })

    test('an empty pools record does not drop it', () => {
        expect(Object.keys(create({ createCognito: true }, {}).pools)).toEqual([DEFAULT_POOL_KEY])
    })

    test('refuses a pools entry claiming the key it already uses', () => {
        // Letting it win is silent, and the winner brings its own name: a different one renames the
        // pool, and a renamed pool is replaced.
        expect(() => create({ createCognito: true }, { [DEFAULT_POOL_KEY]: { name: 'logins', envKeyName: 'L' } }))
            .toThrow(/auth.createCognito already declares the pool 'userPool'/)
    })

    test('the same clash under a renamed key is refused too', () => {
        expect(() => create(
            { createCognito: true, cognitoOptions: { key: 'logins' } },
            { logins: { name: 'logins', envKeyName: 'L' } },
        )).toThrow(/already declares the pool 'logins'/)
    })
})

describe('the single-pool outputs', () => {
    test('name the pool auth.createCognito made', async () => {
        const { pools, auth } = create({ createCognito: true })

        expect(await settled(auth.cognitoARN!)).toBe(await settled(pools[DEFAULT_POOL_KEY].awsPool!.arn))
    })

    test('are undefined for a stack that only declares pools itself', () => {
        const { auth } = create(undefined, { members: { name: 'members', envKeyName: 'M' } })

        expect(auth.cognitoARN).toBeUndefined()
        expect(auth.cognitoPoolId).toBeUndefined()
    })
})

describe('which pools the API accepts tokens from', () => {
    test('is the pick, over created and referenced pools alike', () => {
        const { authorizers, pools } = create(
            undefined,
            { admins: { name: 'admins', envKeyName: 'A' } },
            { partners: { ...reference('PARTNERS_POOL_ID') } },
        )

        expect(authorizers).toEqual([])

        const picked = create(
            { authorizerPools: ['admins', 'partners'] },
            { admins: { name: 'admins', envKeyName: 'A' } },
            { partners: { ...reference('PARTNERS_POOL_ID') } },
        )

        // The resource for one this stack created, the arn for one it only references.
        expect(picked.authorizers).toEqual([picked.pools.admins.awsPool!, 'arn:PARTNERS_POOL_ID'])
        expect(pools.admins.awsPool).toBeDefined()
    })

    test('leaves out a pool declared only to be granted to functions', () => {
        // Declaring a pool and trusting it are separate decisions.
        const { authorizers, pools } = create({ authorizerPools: ['logins'] }, {
            logins: { name: 'logins', envKeyName: 'L' },
            partners: { name: 'partners', envKeyName: 'P' },
        })

        expect(authorizers).toEqual([pools.logins.awsPool!])
    })

    test('includes the pool createCognito builds without it being named', () => {
        const { authorizers, pools } = create({ createCognito: true })

        expect(authorizers).toEqual([pools[DEFAULT_POOL_KEY].awsPool!])
    })

    test('does not include it twice when the pick names it too', () => {
        const { authorizers } = create({ createCognito: true, authorizerPools: [DEFAULT_POOL_KEY] })

        expect(authorizers).toHaveLength(1)
    })

    test('refuses a name no pool answers to', () => {
        expect(() => create({ authorizerPools: ['ghosts'] }, { admins: { name: 'admins', envKeyName: 'A' } }))
            .toThrow(/Cannot authorize with pool 'ghosts'.*The stack has: admins/s)
    })
})

/** The rule `findPool` applies, tested apart from the lookup: a rejected Output is awkward to hold. */
describe('onlyPool', () => {
    test('is the single match', () => {
        expect(onlyPool('partners-test', ['arn:partners'])).toBe('arn:partners')
    })

    test('refuses a name the account holds two of', () => {
        expect(() => onlyPool('twins-test', ['a', 'b']))
            .toThrow(/Cannot reference the pool 'twins-test': the account has 2 of that name, not one/)
    })

    test('refuses a name the account holds none of', () => {
        expect(() => onlyPool('ghost-test', [])).toThrow(/the account has 0 of that name/)
    })
})
