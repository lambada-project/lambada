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
                Resource: await settled(s.Resource as pulumi.Input<string[]>),
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
        expect(statements).toEqual([{ Resource: ['arn:pets-test'], Action: ['dynamodb:GetItem'] }])
    })

    test('puts the whole action list on the index, where IAM applies only the actions an index supports', async () => {
        const { statements } = await statementsFor(owned(pets(undefined, index)), [
            'dynamodb:Query',
            'dynamodb:PutItem',
        ])

        expect(statements).toEqual([
            { Resource: ['arn:pets-test', 'arn:pets-test/index/*'], Action: ['dynamodb:Query', 'dynamodb:PutItem'] },
        ])
    })

    test('names no index when no granted action applies to an index', async () => {
        const { statements } = await statementsFor(owned(pets(undefined, index)), ['dynamodb:PutItem', 'dynamodb:GetItem'])

        expect(statements).toEqual([{ Resource: ['arn:pets-test'], Action: ['dynamodb:PutItem', 'dynamodb:GetItem'] }])
    })

    test('an action in another case, or a wildcard, reaches the index as IAM would match it', async () => {
        for (const access of [['dynamodb:scan'], ['dynamoDb:*'], ['dynamodb:Q*']]) {
            const { statements } = await statementsFor(owned(pets(undefined, index)), access)

            expect(statements[0].Resource).toEqual(['arn:pets-test', 'arn:pets-test/index/*'])
        }
        const { statements } = await statementsFor(owned(pets(undefined, index)), ['dynamodb:Get*'])

        expect(statements[0].Resource).toEqual(['arn:pets-test'])
    })

    test('puts the whole action list on the stream when a stream action is granted', async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: true })), [
            'dynamodb:GetItem',
            'dynamodb:GetRecords',
        ])

        expect(statements).toEqual([
            { Resource: ['arn:pets-test', 'arn:pets-test/stream/now'], Action: ['dynamodb:GetItem', 'dynamodb:GetRecords'] },
        ])
    })

    test('names no stream for a table without streams', async () => {
        const { statements } = await statementsFor(owned(pets()), ['dynamodb:GetRecords'])

        expect(statements[0].Resource).toEqual(['arn:pets-test'])
    })

    test('a referenced table streams from the arn the data source gave', async () => {
        const { statements } = await statementsFor(referenced(pets({ streamEnabled: true })), ['dynamodb:GetRecords'])

        expect(statements[0].Resource).toEqual(['arn:pets-test', 'arn:pets-test/stream/now'])
    })

    test('streams enabled only by the global tableOptions still grant', async () => {
        const { statements } = await statementsFor(owned(pets(), { streamEnabled: true }), ['dynamodb:GetRecords'])

        expect(statements[0].Resource).toEqual(['arn:pets-test', 'arn:pets-test/stream/now'])
    })

    test("a table's own options win over the global", async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: false }), { streamEnabled: true }), [
            'dynamodb:GetRecords',
        ])

        expect(statements[0].Resource).toEqual(['arn:pets-test'])
    })

    test('ListStreams does not name the stream, which IAM scopes to *', async () => {
        const { statements } = await statementsFor(owned(pets({ streamEnabled: true })), ['dynamodb:ListStreams'])

        expect(statements[0].Resource).toEqual(['arn:pets-test'])
    })
})
