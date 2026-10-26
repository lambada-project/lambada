import { describe, expect, test } from 'bun:test'
import { indexesWithoutKeySchemas, StackExport } from './indexKeySchemasState'

const keySchemas = [{ attributeName: 'owner', keyType: 'HASH' }, { attributeName: 'createdAt', keyType: 'RANGE' }]

/** An export holding one resource whose state records this index. */
const exported = (index: Record<string, unknown>, type = 'aws:dynamodb/table:Table'): StackExport => ({
    version: 3,
    deployment: {
        resources: [
            { type: 'pulumi:pulumi:Stack', urn: 'stack' },
            { type, urn: 'table', outputs: { name: 'pets-dev', globalSecondaryIndexes: [index] } },
        ],
    },
})

describe('the check', () => {
    test('names an index whose state records hashKey without keySchemas', () => {
        expect(indexesWithoutKeySchemas(exported({ name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', keySchemas: [] })))
            .toEqual([{ table: 'pets-dev', index: 'byOwner' }])
    })

    test('passes an index whose state also records keySchemas, as a refresh with the program leaves it', () => {
        expect(indexesWithoutKeySchemas(exported({ name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', keySchemas }))).toEqual([])
    })

    test('passes an index recorded by keySchemas alone', () => {
        expect(indexesWithoutKeySchemas(exported({ name: 'byOwner', hashKey: '', keySchemas }))).toEqual([])
    })

    test('ignores anything that is not a DynamoDB table', () => {
        expect(indexesWithoutKeySchemas(exported({ name: 'byOwner', hashKey: 'owner' }, 'aws:s3/bucket:Bucket'))).toEqual([])
    })
})
