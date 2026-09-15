import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDiagnostics } from '../resources/diagnostics'
import { createDynamoDbTables } from '../database'
import { createMessaging } from '../messaging'
import { createKMSKeys, SecurityResult } from '.'

const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        const id = args.id || `${args.name}-id`

        return { id, state: { ...args.inputs, arn: `arn:${id}`, keyId: id } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const key = (name: string) => ({ name, envKeyName: `${name.toUpperCase()}_KEY_ARN` })

const table = (encryptionKeyName?: string) => ({
    pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS', encryptionKeyName },
})
const topic = (encryptionKeyName?: string) => ({
    statusChanged: { name: 'statusChanged', envKeyName: 'STATUS', encryptionKeyName },
})

const tableBuiltWith = async (kmsKeys: SecurityResult | undefined, encryptionKeyName?: string) => {
    built.length = 0
    const tables = createDynamoDbTables('test', table(encryptionKeyName), 'proj', kmsKeys)
    await settled(tables.pets.ref)

    return built.find(r => r.type === 'aws:dynamodb/table:Table')!
}

const topicBuiltWith = async (kmsKeys: SecurityResult | undefined, encryptionKeyName?: string) => {
    built.length = 0
    const messaging = createMessaging('test', topic(encryptionKeyName), undefined, undefined, kmsKeys)
    await settled(messaging.statusChanged.ref)

    return built.find(r => r.type === 'aws:sns/topic:Topic')!
}

describe("a table's encryption key", () => {
    test('is the one its definition names', async () => {
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive') }, undefined)
        const awsTable = await tableBuiltWith(kmsKeys, 'archive')

        expect(awsTable.inputs.serverSideEncryption.enabled).toBe(true)
        expect(await settled(awsTable.inputs.serverSideEncryption.kmsKeyArn)).toBe('arn:proj-archive-test-id')
    })

    test('falls back to `dynamodb` when the definition names none', async () => {
        // Pinned: a live table must not change its SSE key just because the field now exists.
        const kmsKeys = createKMSKeys('proj', 'test', { dynamodb: key('dynamodb') }, undefined)
        const awsTable = await tableBuiltWith(kmsKeys)

        expect(awsTable.inputs.serverSideEncryption.enabled).toBe(true)
        expect(await settled(awsTable.inputs.serverSideEncryption.kmsKeyArn)).toBe('arn:proj-dynamodb-test-id')
    })

    test('is none when the definition names none and there is no `dynamodb`', async () => {
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive') }, undefined)
        const awsTable = await tableBuiltWith(kmsKeys)

        expect(awsTable.inputs.serverSideEncryption.enabled).toBe(false)
    })

    test('an explicit name wins over `dynamodb`', async () => {
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive'), dynamodb: key('dynamodb') }, undefined)
        const awsTable = await tableBuiltWith(kmsKeys, 'archive')

        expect(await settled(awsTable.inputs.serverSideEncryption.kmsKeyArn)).toBe('arn:proj-archive-test-id')
    })
})

describe("a topic's encryption key", () => {
    test('is the one its definition names', async () => {
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive') }, undefined)
        const awsTopic = await topicBuiltWith(kmsKeys, 'archive')

        expect(await settled(awsTopic.inputs.kmsMasterKeyId)).toBe('arn:proj-archive-test-id')
    })

    test('is absent when the definition names none, `dynamodb` or not', async () => {
        // Topics have never been encrypted, so there is no legacy pick to preserve.
        const kmsKeys = createKMSKeys('proj', 'test', { dynamodb: key('dynamodb') }, undefined)
        const awsTopic = await topicBuiltWith(kmsKeys)

        expect(awsTopic.inputs.kmsMasterKeyId).toBeUndefined()
    })

    test('leaves a key given through options alone', async () => {
        const messaging = createMessaging('test', {
            statusChanged: {
                name: 'statusChanged',
                envKeyName: 'STATUS',
                options: { kmsMasterKeyId: 'alias/aws/sns' },
            },
        })

        built.length = 0
        await settled(messaging.statusChanged.ref)

        expect(built.find(r => r.type === 'aws:sns/topic:Topic')!.inputs.kmsMasterKeyId).toBe('alias/aws/sns')
    })
})

describe('a name no key answers to', () => {
    test('is collected for the other diagnostics rather than thrown one at a time', () => {
        const diagnostics = createDiagnostics()
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive') }, undefined)

        createDynamoDbTables('test', table('ghost'), 'proj', kmsKeys, undefined, undefined, undefined, diagnostics)
        createMessaging('test', topic('phantom'), undefined, undefined, kmsKeys, diagnostics)

        expect(() => diagnostics.throwIfIncomplete()).toThrow(
            /2 resources that are granted but absent[\s\S]*table 'pets'[\s\S]*kmsKey 'ghost'[\s\S]*topic 'statusChanged'[\s\S]*kmsKey 'phantom'/,
        )
    })

    test('throws on the spot for a caller that collects nothing', () => {
        const kmsKeys = createKMSKeys('proj', 'test', { archive: key('archive') }, undefined)

        expect(() => createDynamoDbTables('test', table('ghost'), 'proj', kmsKeys))
            .toThrow(/table 'pets' encrypts with kmsKey 'ghost'.*The stack has: archive/s)
    })
})
