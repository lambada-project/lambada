import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables, INDEX_KEY_SCHEMAS_TAG, indexKeyForms, isMissingTable, TableDefinition } from '.'

const created: pulumi.runtime.MockResourceArgs[] = []
const inAws: Record<string, { globalSecondaryIndexes: { name: string }[], tags: Record<string, string> }> = {}

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token !== 'aws:dynamodb/getTable:getTable') return {}
        const table = inAws[args.inputs.name]
        if (!table) throw new Error(`reading Amazon DynamoDB Table (${args.inputs.name}): couldn't find resource`)
        return table
    },
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const old = { name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', projectionType: 'ALL' }
const keySchemas = [{ attributeName: 'owner', keyType: 'HASH' }, { attributeName: 'createdAt', keyType: 'RANGE' }]
const both = { ...old, keySchemas }
const current = { name: 'byOwner', projectionType: 'ALL', keySchemas }

const table = (indexNames: string[], tags: Record<string, string> = {}) =>
    ({ globalSecondaryIndexes: indexNames.map(name => ({ name })), tags }) as never

describe('an index declared with hashKey and rangeKey', () => {
    test('is created from keySchemas alone when its table does not exist yet', () => {
        expect(indexKeyForms([old], undefined)).toEqual([current])
    })

    test('is created from keySchemas alone when its table exists without it', () => {
        expect(indexKeyForms([old], table(['other']))).toEqual([current])
    })

    test('is stated both ways while its table has not taken that deploy', () => {
        expect(indexKeyForms([old], table(['byOwner']))).toEqual([both])
    })

    test('is stated by keySchemas alone once its table has taken that deploy', () => {
        expect(indexKeyForms([old], table(['byOwner'], { [INDEX_KEY_SCHEMAS_TAG]: 'keySchemas' }))).toEqual([current])
    })

    test('without a rangeKey has only a HASH key schema', () => {
        const [index] = indexKeyForms([{ name: 'byOwner', hashKey: 'owner', projectionType: 'ALL' }], undefined)

        expect(index.keySchemas).toEqual([{ attributeName: 'owner', keyType: 'HASH' }])
    })
})

test('an index declared with keySchemas is kept as declared', () => {
    expect(indexKeyForms([current], table(['byOwner']))).toEqual([current])
})

let tables = 0

/** What createDynamoDbTables gives the provider for a table whose DynamoDB copy is `existing`. */
const tableArgs = async (indexes: TableDefinition['indexes'], existing?: ReturnType<typeof table>) => {
    const name = `pets${tables++}`
    if (existing) inAws[`${name}-test`] = existing
    const result = createDynamoDbTables('test', { [name]: { name, primaryKey: 'id', envKeyName: 'PETS', indexes } })
    await settled(result[name].ref.arn)
    return created.find(r => r.type === 'aws:dynamodb/table:Table' && r.name === `${name}-test`)!.inputs
}

describe('a table', () => {
    test('with indexes reads its DynamoDB copy, and is tagged as having taken the both-ways deploy', async () => {
        const args = await tableArgs([old], table(['byOwner']))

        expect(args.globalSecondaryIndexes).toEqual([both])
        expect(args.tags).toEqual({ [INDEX_KEY_SCHEMAS_TAG]: 'keySchemas' })
    })

    test('without indexes is left untagged', async () => {
        expect((await tableArgs(undefined)).tags).toBeUndefined()
    })
})

describe('a failed lookup of a table', () => {
    test('reads as a missing table in the words the provider uses', () => {
        expect(isMissingTable(new Error(
            'invoking aws:dynamodb/getTable:getTable: 1 error occurred:\n\t* reading Dynamodb Table (pets-dev): couldn\'t find resource\n\n'))).toBe(true)
    })

    test('for any other reason is not a missing table', () => {
        expect(isMissingTable(new Error('operation error DynamoDB: DescribeTable, AccessDeniedException'))).toBe(false)
    })
})
