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
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, keyId: `${args.name}-keyId` } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:kms/getAlias:getAlias') {
            const name = args.inputs.name as string
            return { name, arn: `arn:${name}`, targetKeyId: `${name}-target-id`, targetKeyArn: `arn:target:${name}` }
        }
        return {}
    },
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const create = (keys?: Parameters<typeof createKMSKeys>[2], keysRef?: Parameters<typeof createKMSKeys>[3]) =>
    createKMSKeys('proj', 'test', keys, keysRef)

const definition = (name: string, envKeyName: string) => ({ name, envKeyName })
const byValue = (envKeyName: string) => ({ id: `${envKeyName}-id`, arn: `arn:${envKeyName}`, envKeyName })

describe('createKMSKeys', () => {
    test('is empty when the stack neither creates nor references one', () => {
        expect(create()).toEqual({})
    })

    test('gives a created key the same ref shape a referenced one has', async () => {
        const keys = create({ data: definition('data', 'DATA_KEY_ARN') })

        expect(keys.data!.awsKmsKey).toBeDefined()
        expect(await settled(keys.data!.ref.arn)).toBe('arn:proj-data-test')
        expect(await settled(keys.data!.ref.id)).toBe('proj-data-test-keyId')
    })

    test('names the alias a consumer references it by', () => {
        create({ data: definition('data', 'DATA_KEY_ARN') })

        const alias = built.find(r => r.type === 'aws:kms/alias:Alias')
        expect(alias!.inputs.name).toBe(keyAlias('proj', 'data', 'test'))
    })

    test('resolves a ref given by name through the alias', async () => {
        const keys = create(undefined, { shared: definition('shared', 'SHARED_KEY_ARN') })

        expect(keys.shared!.awsKmsKey).toBeUndefined()
        expect(await settled(keys.shared!.ref.arn)).toBe(`arn:target:${keyAlias('proj', 'shared', 'test')}`)
        expect(await settled(keys.shared!.ref.id)).toBe(`${keyAlias('proj', 'shared', 'test')}-target-id`)
    })

    test('takes a ref given by value for a key outside the convention', async () => {
        const keys = create(undefined, { outside: byValue('OUTSIDE_KEY_ARN') })

        expect(keys.outside!.awsKmsKey).toBeUndefined()
        expect(await settled(keys.outside!.ref.arn)).toBe('arn:OUTSIDE_KEY_ARN')
    })

    test('both ref forms sit in one record', async () => {
        const keys = create(undefined, {
            shared: definition('shared', 'SHARED_KEY_ARN'),
            outside: byValue('OUTSIDE_KEY_ARN'),
        })

        expect(Object.keys(keys).sort()).toEqual(['outside', 'shared'])
        expect(await settled(keys.shared!.ref.arn)).toBe(`arn:target:${keyAlias('proj', 'shared', 'test')}`)
        expect(await settled(keys.outside!.ref.arn)).toBe('arn:OUTSIDE_KEY_ARN')
    })

    test('passes an already-resolved result item straight through', () => {
        const existing: SecurityResult = {
            shared: { ref: { id: 'i', arn: 'a' }, definition: definition('shared', 'S') },
        }

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

        expect(await settled(grant.kmsKey!.ref.arn)).toBe(`arn:target:${keyAlias('proj', 'shared', 'test')}`)
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
            `arn:target:${keyAlias('proj', 'dynamodb', 'test')}`,
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
                outside: { id: 'k', arn: 'arn:k', envKeyName: 'OUTSIDE_KEY_ARN' },
            },
        }

        expect(Object.keys(args.keysRef!)).toHaveLength(2)
    })
})
