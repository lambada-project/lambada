import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables, DatabaseResult, TableDefinition } from '../database'
import { toLambdaResources } from '../resources/grants'
import { resourceStatements } from '.'

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({
        id: `${args.name}-id`,
        state: {
            ...args.inputs,
            arn: `arn:${args.name}`,
            streamArn: args.inputs.streamEnabled ? `arn:${args.name}/stream/now` : '',
        },
    }),
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:dynamodb/getTable:getTable') {
            const name = args.inputs.name as string

            return { name, id: name, arn: `arn:${name}`, hashKey: 'id', streamArn: `arn:${name}/stream/now` }
        }
        return {}
    },
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const index = [{ name: 'byOwner', hashKey: 'owner', projectionType: 'ALL' }] as TableDefinition['indexes']

const pets = (options?: TableDefinition['options'], indexes?: TableDefinition['indexes']): TableDefinition => ({
    name: 'pets',
    primaryKey: 'id',
    envKeyName: 'PETS',
    options,
    indexes,
})

/** Every statement the grant emits, with its Resource resolved. */
const statementsFor = async (databases: DatabaseResult, access: readonly string[]) => {
    const [grant] = toLambdaResources({ databases } as never, {
        name: 'fn',
        resources: { table: { pets: access as never } },
    })

    const { statements, envVars } = resourceStatements(grant, 'fn', 'test')

    return {
        envVars,
        statements: await Promise.all(
            statements.map(async (s) => ({
                Resource: await settled(s.Resource as pulumi.Input<string>),
                Action: s.Action,
            })),
        ),
    }
}

const owned = (definition: TableDefinition, globalOptions?: TableDefinition['options']) =>
    createDynamoDbTables('test', { pets: definition }, undefined, undefined, undefined, undefined, globalOptions)
const referenced = (definition: TableDefinition) =>
    createDynamoDbTables('test', undefined, undefined, undefined, { pets: definition })

describe('a table grant', () => {
    test('publishes the table name and grants the table arn', async () => {
        const { statements, envVars } = await statementsFor(owned(pets()), ['dynamodb:GetItem'])

        expect(await settled(envVars.PETS)).toBe('pets-test')
        expect(statements).toEqual([{ Resource: 'arn:pets-test', Action: ['dynamodb:GetItem'] }])
    })

    test('puts only read actions on the index', async () => {
        const { statements } = await statementsFor(owned(pets(undefined, index)), [
            'dynamodb:Query',
            'dynamodb:PutItem',
        ])

        expect(statements).toEqual([
            { Resource: 'arn:pets-test', Action: ['dynamodb:Query', 'dynamodb:PutItem'] },
            { Resource: 'arn:pets-test/index/*', Action: ['dynamodb:Query'] },
        ])
    })

    test('emits no index statement when only writes are granted', async () => {
        const { statements } = await statementsFor(owned(pets(undefined, index)), ['dynamodb:PutItem'])

        expect(statements).toHaveLength(1)
    })

    test('grants stream actions on the stream arn, not the table', async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: true })), [
            'dynamodb:GetItem',
            'dynamodb:GetRecords',
        ])

        expect(statements).toEqual([
            { Resource: 'arn:pets-test', Action: ['dynamodb:GetItem', 'dynamodb:GetRecords'] },
            { Resource: 'arn:pets-test/stream/now', Action: ['dynamodb:GetRecords'] },
        ])
    })

    test('emits no stream statement for a table without streams', async () => {
        const { statements } = await statementsFor(owned(pets()), ['dynamodb:GetRecords'])

        expect(statements).toHaveLength(1)
    })

    test('a referenced table streams from the arn the data source gave', async () => {
        const { statements } = await statementsFor(referenced(pets({ streamEnabled: true })), ['dynamodb:GetRecords'])

        expect(statements[1]).toEqual({ Resource: 'arn:pets-test/stream/now', Action: ['dynamodb:GetRecords'] })
    })

    test('streams enabled only by the global tableOptions still grant', async () => {
        const { statements } = await statementsFor(owned(pets(), { streamEnabled: true }), ['dynamodb:GetRecords'])

        expect(statements[1]).toEqual({ Resource: 'arn:pets-test/stream/now', Action: ['dynamodb:GetRecords'] })
    })

    test("a table's own options win over the global", async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: false }), { streamEnabled: true }), [
            'dynamodb:GetRecords',
        ])

        expect(statements).toHaveLength(1)
    })

    test('ListStreams is not put on the stream, which IAM scopes to *', async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: true })), ['dynamodb:ListStreams'])

        expect(statements).toHaveLength(1)
    })
})
