import { describe, expect, spyOn, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { createDynamoDbTables } from '../database'
import { createSchedules } from '../schedules'
import { tableKeyStatements } from '.'

const created: pulumi.runtime.MockResourceArgs[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

describe("the key statements of a lambda's tables", () => {
    test('decrypt each key only through DynamoDB, for the tables it encrypts', () => {
        expect(tableKeyStatements([
            { name: 'orders-dev', kmsKeyArn: 'arn:key/a' },
            { name: 'quotes-dev', kmsKeyArn: 'arn:key/a' },
            { name: 'users-dev', kmsKeyArn: 'arn:key/b' },
        ])).toEqual([
            {
                Effect: 'Allow', Action: ['kms:Decrypt'], Resource: 'arn:key/a',
                Condition: {
                    StringLike: { 'kms:ViaService': 'dynamodb.*.amazonaws.com' },
                    StringEquals: { 'kms:EncryptionContext:aws:dynamodb:tableName': ['orders-dev', 'quotes-dev'] },
                },
            },
            {
                Effect: 'Allow', Action: ['kms:Decrypt'], Resource: 'arn:key/b',
                Condition: {
                    StringLike: { 'kms:ViaService': 'dynamodb.*.amazonaws.com' },
                    StringEquals: { 'kms:EncryptionContext:aws:dynamodb:tableName': ['users-dev'] },
                },
            },
        ])
    })

    test('are none for tables no customer managed key encrypts', () => {
        expect(tableKeyStatements([{ name: 'plain-dev', kmsKeyArn: '' }])).toEqual([])
    })
})

describe("a stack's key", () => {
    const warn = spyOn(pulumi.log, 'warn')
    const environment = 'test'
    const kmsKeys = { dynamodb: { awsKmsKey: new aws.kms.Key('dynamodb') } }
    const context = { environment, kmsKeys, databases: createDynamoDbTables(environment, { quotes: { name: 'quotes', primaryKey: 'id', envKeyName: 'QUOTES' } }, undefined, kmsKeys as never) }

    const policyOf = async (name: string, resources: object) => {
        const [subscription] = createSchedules(context as never, [{
            name, schedule: { every: { minutes: 5 } }, callback: { functionFolder: '.', handler: 'index.main' }, resources: resources as never,
        }])
        await settled(pulumi.all([subscription.eventRule.arn, subscription.target.arn, subscription.permission.id]))
        await new Promise(done => setTimeout(done, 20))
        const roleArn = await settled<string>(created.find(r => r.type === 'aws:lambda/function:Function' && r.name === `${name}-test`)!.inputs.role)
        const policyName = roleArn.replace(/^arn:/, '').replace(/-role$/, '-policy')
        return JSON.stringify(await settled(created.find(r => r.type === 'aws:iam/policy:Policy' && r.name === policyName)!.inputs.policy))
    }

    test('is decrypted, through DynamoDB, by a lambda granted a table it encrypts', async () => {
        const policy = await policyOf('readQuotes', { table: { quotes: ['dynamodb:GetItem'] } })

        expect(policy).toContain('"Action":["kms:decrypt"]')
        expect(policy).toContain('"kms:EncryptionContext:aws:dynamodb:tableName":["quotes-test"]')
        expect(policy).toContain('"Resource":"arn:dynamodb"')
    })

    test('is not granted to a lambda that reads no table it encrypts', async () => {
        expect(await policyOf('tidyUp', [{ arn: 'arn:aws:sns:us-east-1:123456789012:tidy-up', access: ['sns:Publish'] }])).not.toContain('kms:')
    })

    test('chosen for a table that names none is a deprecation warning', () => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("table quotes names no encryptionKeyName, so it takes the key named 'dynamodb'"))
    })
})
