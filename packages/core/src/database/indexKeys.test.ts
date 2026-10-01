import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables, TableDefinition, TableOptions } from '.'

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

let tables = 0

/** The global secondary indexes of the table createDynamoDbTables builds for these indexes. */
const indexesOf = async (indexes: TableDefinition['indexes'], options?: TableOptions) => {
    const name = `pets${tables++}`
    const result = createDynamoDbTables('test', { [name]: { name, primaryKey: 'id', envKeyName: 'PETS', indexes, options } })
    await settled(result[name].ref.arn)
    return created.find(r => r.type === 'aws:dynamodb/table:Table' && r.name === `${name}-test`)!.inputs.globalSecondaryIndexes
}

describe("a table's indexes", () => {
    test('reach the provider with hashKey and rangeKey as declared', async () => {
        const index = { name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', projectionType: 'ALL' }

        expect(await indexesOf([index])).toEqual([index])
    })

    test('reach the provider with keySchemas as declared', async () => {
        const index = { name: 'byOwner', projectionType: 'ALL', keySchemas: [{ attributeName: 'owner', keyType: 'HASH' }] }

        expect(await indexesOf([index])).toEqual([index])
    })
})
