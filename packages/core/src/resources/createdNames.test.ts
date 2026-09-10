import { beforeAll, describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createPools } from '../auth/pools'
import { createBuckets } from '../buckets'
import { createDynamoDbTables } from '../database'
import { createMessaging } from '../messaging'
import { createQueues } from '../queue'
import { createKMSKeys, createSecrets } from '../security'

/**
 * The physical name of every resource lambada creates, pinned to a literal. A rename replaces a live
 * resource, taking its data with it, so a change to any of these must fail here first.
 */
const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, keyId: `${args.name}-keyId` } }
    },
    call: () => ({}),
})

/** Registration resolves off the event loop, and an alias has no output anyone awaits. */
const drain = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const of = (type: string) => built.filter(r => r.type === type)
const nameOf = (type: string) => of(type).map(r => [r.name, r.inputs.name] as const)

beforeAll(async () => {
    const keys = createKMSKeys('proj', 'test', { data: { name: 'data', envKeyName: 'DATA_KEY_ARN' } }, undefined)

    createDynamoDbTables('test', { pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS' } }, 'proj')
    createDynamoDbTables('test', { toys: { name: 'toys', primaryKey: 'id', envKeyName: 'TOYS' } })
    createMessaging('test', { statusChanged: { name: 'statusChanged', envKeyName: 'STATUS_TOPIC_ARN' } })
    createQueues('test', {
        provisioning: { name: 'provisioning', envKeyName: 'PROVISIONING_QUEUE_URL' },
        ordered: { name: 'ordered', envKeyName: 'ORDERED_QUEUE_URL', options: { fifoQueue: true } },
    })
    createSecrets('proj', 'test', { token: { name: 'token', envKeyName: 'TOKEN' } })
    createBuckets('test', { uploads: { name: 'uploads', envKeyName: 'UPLOADS_BUCKET' } })
    createPools('proj', 'test', keys, { createCognito: true }, { members: { name: 'members', envKeyName: 'MEMBERS' } })

    await drain()
})

describe('the physical name of a created resource', () => {
    test('a table takes tablePrefix, and none when there is none', () => {
        expect(nameOf('aws:dynamodb/table:Table')).toEqual([
            ['proj-pets-test', 'proj-pets-test'],
            ['toys-test', 'toys-test'],
        ])
    })

    test('a topic is its definition name and the environment', () => {
        expect(nameOf('aws:sns/topic:Topic')).toEqual([['statusChanged', 'statusChanged-test']])
    })

    test('a queue is the same, and a fifo queue carries the suffix SQS requires', async () => {
        const [plain, fifo] = of('aws:sqs/queue:Queue')

        expect([plain.name, await settled<string>(plain.inputs.name)])
            .toEqual(['provisioning', 'provisioning-test'])
        expect([fifo.name, await settled<string>(fifo.inputs.name)])
            .toEqual(['ordered', 'ordered-test.fifo'])
    })

    test('a bucket takes no project prefix, and sits under `bucket` rather than `name`', () => {
        const [bucket] = of('aws:s3/bucket:Bucket')

        expect([bucket.name, bucket.inputs.bucket]).toEqual(['uploads-test', 'uploads-test'])
    })

    test('a secret carries the project that created it', () => {
        expect(nameOf('aws:secretsmanager/secret:Secret')).toEqual([['proj-token-test', 'proj-token-test']])
    })

    test('a key carries the project too, and has no name in AWS', () => {
        const [key] = of('aws:kms/key:Key')

        expect(key.name).toBe('proj-data-test')
        expect(key.inputs.name).toBeUndefined()
    })

    test('a key alias is the only name a consumer can reference it by', () => {
        expect(nameOf('aws:kms/alias:Alias')).toEqual([['alias/proj-data-test', 'alias/proj-data-test']])
    })

    test('a pool is its definition name, and the createCognito one is the project', () => {
        expect(nameOf('aws:cognito/userPool:UserPool').sort()).toEqual([
            ['members-test', 'members-test'],
            ['proj-test', 'proj-test'],
        ])
    })
})

describe('the dynamodb key special case', () => {
    test('creates two keys, and the result carries the loop one', async () => {
        built.length = 0
        const keys = createKMSKeys('proj', 'test', { dynamodb: { name: 'dynamodb', envKeyName: 'DYNAMO' } }, undefined)
        await settled(keys.dynamodb!.awsKmsKey.arn)
        await drain()

        expect(of('aws:kms/key:Key').map(r => r.name).sort())
            .toEqual(['proj-dynamodb-data-encryption-test', 'proj-dynamodb-test'])

        // The loop runs second and wins the record, so this is the key tables encrypt with.
        expect(await settled(keys.dynamodb!.awsKmsKey.urn)).toContain('proj-dynamodb-test')
    })
})
