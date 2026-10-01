import { describe, expect, test } from 'bun:test'
import { StackExport, withIndexKeySchemas } from './indexKeySchemasState'

const keySchemas = [{ attributeName: 'owner', keyType: 'HASH' }, { attributeName: 'createdAt', keyType: 'RANGE' }]

/** An export holding one table whose index both sides record as given. */
const exported = (index: Record<string, unknown>, type = 'aws:dynamodb/table:Table'): StackExport => ({
    version: 3,
    deployment: {
        manifest: {},
        resources: [
            { type: 'pulumi:pulumi:Stack', urn: 'stack' },
            { type, urn: 'table', inputs: { name: 'pets-dev', globalSecondaryIndexes: [index] }, outputs: { name: 'pets-dev', globalSecondaryIndexes: [index] } },
        ],
    },
})

const indexesOf = (state: StackExport) => state.deployment.resources!.flatMap(r =>
    [r.inputs?.globalSecondaryIndexes, r.outputs?.globalSecondaryIndexes].filter(Boolean))

describe('an index recorded with hashKey and rangeKey', () => {
    test('also states them as keySchemas, on both sides of the state', () => {
        const old = { name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', projectionType: 'ALL' }

        const { state, patched } = withIndexKeySchemas(exported(old))

        expect(indexesOf(state)).toEqual([[{ ...old, keySchemas }], [{ ...old, keySchemas }]])
        expect(patched).toBe(2)
    })

    test('without a rangeKey, as an older provider records it, has only a HASH key schema', () => {
        const { state } = withIndexKeySchemas(exported({ name: 'byOwner', hashKey: 'owner', rangeKey: '', projectionType: 'ALL' }))

        expect(indexesOf(state)[0]).toEqual([expect.objectContaining({ keySchemas: [{ attributeName: 'owner', keyType: 'HASH' }] })])
    })
})

test('an index that already records keySchemas is left as it was', () => {
    const current = { name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', keySchemas }

    expect(withIndexKeySchemas(exported(current))).toEqual({ state: exported(current), patched: 0 })
})

test('anything that is not a DynamoDB table is left as it was', () => {
    const index = { name: 'byOwner', hashKey: 'owner' }

    expect(withIndexKeySchemas(exported(index, 'aws:s3/bucket:Bucket')).patched).toBe(0)
})

test('patching twice is patching once', () => {
    const once = withIndexKeySchemas(exported({ name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt' })).state

    expect(withIndexKeySchemas(once)).toEqual({ state: once, patched: 0 })
})

test('the export it was given is left as it was', () => {
    const given = exported({ name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt' })
    const copy = structuredClone(given)

    withIndexKeySchemas(given)

    expect(given).toEqual(copy)
})
