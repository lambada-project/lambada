import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments } from '..'
import { createDynamoDbTables } from '../database'
import { toLambdaResources } from '../resources/grants'
import { createKMSKeys, keyAlias, SecurityResult } from '.'

/** Every resource the engine was asked to build, so a table's encryption args are visible here. */
const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        // A `.get` arrives here with the fetched id on `args.id`, which is what names the arn.
        const id = args.id || `${args.name}-id`

        return { id, state: { ...args.inputs, arn: `arn:${id}`, keyId: id } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:kms/getAlias:getAlias') {
            const name = args.inputs.name as string
            looked.push(name)
            return { name, arn: `arn:${name}`, targetKeyId: `${name}-target-id`, targetKeyArn: `arn:target:${name}` }
        }
        return {}
    },
})

/** Every alias a ref asked for. */
const looked: string[] = []

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const create = (keys?: Parameters<typeof createKMSKeys>[2], keysRef?: Parameters<typeof createKMSKeys>[3]) =>
    createKMSKeys('proj', 'test', keys, keysRef)

const definition = (name: string, envKeyName: string) => ({ name, envKeyName })
const byValue = (envKeyName: string) => ({ id: `${envKeyName}-id`, envKeyName })

describe('createKMSKeys', () => {
    test('is empty when the stack neither creates nor references one', () => {
        expect(create()).toEqual({})
    })

    test('gives a created key a real resource', async () => {
        const keys = create({ data: definition('data', 'DATA_KEY_ARN') })

        expect(await settled(keys.data!.awsKmsKey.arn)).toBe('arn:proj-data-test-id')
    })

    test('builds a created key under the project-prefixed physical name', async () => {
        const keys = create({ data: definition('data', 'DATA_KEY_ARN') })

        expect(await settled(keys.data!.awsKmsKey.urn)).toContain('proj-data-test')
    })

    test('resolves a ref given by name to the key the alias points at', async () => {
        const keys = create(undefined, { shared: definition('shared', 'SHARED_KEY_ARN') })

        // A real resource, fetched: the same thing an owned key gives every reader.
        expect(await settled(keys.shared!.awsKmsKey.keyId)).toBe(`${keyAlias('shared', 'test')}-target-id`)
        expect(await settled(keys.shared!.awsKmsKey.arn)).toBe(`arn:${keyAlias('shared', 'test')}-target-id`)
    })

    test('fetches a ref given by id for a key outside the convention', async () => {
        const keys = create(undefined, { outside: byValue('OUTSIDE_KEY_ARN') })

        expect(await settled(keys.outside!.awsKmsKey.keyId)).toBe('OUTSIDE_KEY_ARN-id')
        expect(keys.outside!.definition).toEqual({ name: 'outside', envKeyName: 'OUTSIDE_KEY_ARN' })
    })

    test('both ref forms sit in one record', async () => {
        const keys = create(undefined, {
            shared: definition('shared', 'SHARED_KEY_ARN'),
            outside: byValue('OUTSIDE_KEY_ARN'),
        })

        expect(Object.keys(keys).sort()).toEqual(['outside', 'shared'])
        expect(await settled(keys.shared!.awsKmsKey.keyId)).toBe(`${keyAlias('shared', 'test')}-target-id`)
        expect(await settled(keys.outside!.awsKmsKey.keyId)).toBe('OUTSIDE_KEY_ARN-id')
    })

    test('spells the owner project in the name, not the consumer one', async () => {
        // The consumer is 'proj'; the key belongs to 'eldorado'. Nothing of 'proj' may appear.
        const keys = create(undefined, { shared: definition('eldorado-data', 'DATA_KEY_ARN') })

        expect(await settled(keys.shared!.awsKmsKey.keyId)).toBe(`${keyAlias('eldorado-data', 'test')}-target-id`)
    })

    test('passes an already-resolved result item straight through', () => {
        const existing: SecurityResult = create({ shared: definition('shared', 'S') })

        expect(create(undefined, existing).shared).toBe(existing.shared)
    })

    test('refuses to reference a key under the name of one it created', () => {
        expect(() => create({ data: definition('data', 'A') }, { data: definition('data', 'B') }))
            .toThrow(/Cannot create a ref key with the same name of an existing key: data/)
    })
})

describe('a granted key', () => {
    const grantFor = (kmsKeys: SecurityResult) =>
        toLambdaResources({ kmsKeys } as any, { name: 'fn', resources: { kmsKey: { shared: ['kms:Decrypt'] } } })

    test('resolves a referenced key to the same arn a created one gives', async () => {
        const [grant] = grantFor(create(undefined, { shared: definition('shared', 'SHARED_KEY_ARN') }))

        expect(await settled(grant.kmsKey!.awsKmsKey.arn)).toBe(`arn:${keyAlias('shared', 'test')}-target-id`)
        expect(grant.kmsKey!.definition!.envKeyName).toBe('SHARED_KEY_ARN')
    })

    test('is refused by name when the stack carries no such key', () => {
        expect(() => grantFor(create())).toThrow(/needs kmsKey 'shared'/)
    })
})

/** Registration is async: the mock only sees the table once its own output has resolved. */
const tableBuiltBy = async (kmsKeys: SecurityResult | undefined) => {
    built.length = 0
    const tables = createDynamoDbTables('test', { pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS' } }, 'proj', kmsKeys)
    await settled(tables.pets.ref)

    return built.find(r => r.type === 'aws:dynamodb/table:Table')!
}

describe('a table encrypted with a referenced key', () => {
    test('takes the arn the alias resolved to', async () => {
        const kmsKeys = create(undefined, { dynamodb: definition('dynamodb', 'DYNAMO_KEY_ARN') })

        const table = await tableBuiltBy(kmsKeys)

        expect(table.inputs.serverSideEncryption.enabled).toBe(true)
        expect(await settled(table!.inputs.serverSideEncryption.kmsKeyArn)).toBe(
            `arn:${keyAlias('dynamodb', 'test')}-target-id`,
        )
    })

    test('is unencrypted when the stack has no key', async () => {
        const table = await tableBuiltBy(undefined)

        expect(table.inputs.serverSideEncryption.enabled).toBe(false)
    })
})

describe('what run() accepts as keysRef', () => {
    // Compile-time. The runtime body only keeps the test runner honest.
    test('a record of definitions, with no key of its own', () => {
        const args: LambadaRunArguments = {
            keysRef: { shared: { name: 'shared', envKeyName: 'SHARED_KEY_ARN' } },
        }

        expect(args.keysRef).toBeDefined()
    })

    test('a record mixing a definition and an explicit reference', () => {
        const args: LambadaRunArguments = {
            keysRef: {
                shared: { name: 'shared', envKeyName: 'SHARED_KEY_ARN' },
                outside: { id: 'k', envKeyName: 'OUTSIDE_KEY_ARN' },
            },
        }

        expect(Object.keys(args.keysRef!)).toHaveLength(2)
    })
})

describe('the owner and ref conventions meet', () => {
    test('a ref spelling `${ownerProject}-${key}` finds the alias the owner published', async () => {
        // The owner's key resource carries its physical base name, which is what it aliases.
        const owned = createKMSKeys('eldorado', 'test', { data: definition('data', 'DATA_KEY_ARN') }, undefined)
        expect(await settled(owned.data!.awsKmsKey.urn)).toContain('eldorado-data-test')

        looked.length = 0
        const referenced = create(undefined, { data: definition('eldorado-data', 'DATA_KEY_ARN') })
        await settled(referenced.data!.awsKmsKey.arn)

        expect(looked).toEqual([keyAlias('eldorado-data', 'test')])
        expect(looked[0]).toBe('alias/eldorado-data-test')
    })

    test('a ref never spells the consumer project', async () => {
        looked.length = 0
        const referenced = create(undefined, { data: definition('eldorado-data', 'DATA_KEY_ARN') })
        await settled(referenced.data!.awsKmsKey.arn)

        expect(looked.some(alias => alias.includes('proj'))).toBe(false)
    })
})
