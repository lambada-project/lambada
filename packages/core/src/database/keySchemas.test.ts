import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { withKeySchemas } from '.'

describe('withKeySchemas', () => {
    test('an index keeps its partition key and sort key, stated in keySchemas', () => {
        expect(withKeySchemas({ name: 'byOwner', hashKey: 'owner', rangeKey: 'createdAt', projectionType: 'ALL' }))
            .toEqual({
                name: 'byOwner',
                projectionType: 'ALL',
                keySchemas: [
                    { attributeName: 'owner', keyType: 'HASH' },
                    { attributeName: 'createdAt', keyType: 'RANGE' },
                ],
            })
    })

    test('an index with only a partition key gets no sort key', () => {
        expect(withKeySchemas({ name: 'byOwner', hashKey: 'owner', projectionType: 'KEYS_ONLY' }).keySchemas)
            .toEqual([{ attributeName: 'owner', keyType: 'HASH' }])
    })

    test('an index that already states keySchemas keeps them', () => {
        const index = {
            name: 'byOwner',
            projectionType: 'ALL',
            keySchemas: [{ attributeName: 'owner', keyType: 'HASH' }],
        }

        expect(withKeySchemas(index)).toBe(index)
    })

    test('an index whose key is not yet known states it in keySchemas too', () => {
        const owner = pulumi.output('owner')

        expect(withKeySchemas({ name: 'byOwner', hashKey: owner, projectionType: 'ALL' }).keySchemas)
            .toEqual([{ attributeName: owner, keyType: 'HASH' }])
    })
})
