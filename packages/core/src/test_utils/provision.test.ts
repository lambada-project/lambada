import { describe, expect, test } from 'bun:test'
import type { DynamoDB, TableDescription } from '@aws-sdk/client-dynamodb'
import type { TableDefinition } from '../database'
import type { KMS } from '@aws-sdk/client-kms'
import { isActive, removeKey, tableInput, waitUntilActive } from './provision'

const pets: TableDefinition = {
    name: 'pets',
    envKeyName: 'PETS_TABLE',
    primaryKey: 'pk',
    rangeKey: 'sk',
    attributes: [{ name: 'owner', type: 'S' }],
    indexes: [{ name: 'byOwner', hashKey: 'owner', projectionType: 'ALL' }],
}

/** The store answers each describe from the list, then repeats the last answer. */
const storeAnswering = (...answers: TableDescription[]) => {
    let calls = 0
    const db = {
        describeTable: async () => ({ Table: answers[Math.min(calls++, answers.length - 1)] }),
    } as unknown as DynamoDB
    return { db, calls: () => calls }
}

describe('the table the runner creates', () => {
    test('bills on demand, so a store that enforces provisioned units never throttles a test', () => {
        const input = tableInput(pets, 'pets-test')

        expect(input.BillingMode).toBe('PAY_PER_REQUEST')
        expect(input.ProvisionedThroughput).toBeUndefined()
    })

    test('declares no provisioned units on an index, which a pay per request table refuses', () => {
        const input = tableInput(pets, 'pets-test')

        expect(input.GlobalSecondaryIndexes?.map((x) => x.IndexName)).toEqual(['byOwner'])
        expect(input.GlobalSecondaryIndexes?.every((x) => x.ProvisionedThroughput === undefined)).toBe(true)
    })

    test('keeps the keys of the definition', () => {
        const input = tableInput(pets, 'pets-test')

        expect(input.TableName).toBe('pets-test')
        expect(input.KeySchema).toEqual([
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
        ])
    })
})

describe('a table that takes writes', () => {
    test('is ACTIVE with no index', () => {
        expect(isActive({ TableStatus: 'ACTIVE' })).toBe(true)
    })

    test('is not CREATING', () => {
        expect(isActive({ TableStatus: 'CREATING' })).toBe(false)
    })

    test('has each index ACTIVE, not only the table', () => {
        const withIndex = (IndexStatus: 'ACTIVE' | 'CREATING'): TableDescription => ({
            TableStatus: 'ACTIVE',
            GlobalSecondaryIndexes: [{ IndexName: 'byOwner', IndexStatus }],
        })

        expect(isActive(withIndex('CREATING'))).toBe(false)
        expect(isActive(withIndex('ACTIVE'))).toBe(true)
    })
})

describe('the wait for a table', () => {
    test('returns when the table and its index turn ACTIVE', async () => {
        const store = storeAnswering(
            { TableStatus: 'CREATING' },
            { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [{ IndexName: 'byOwner', IndexStatus: 'CREATING' }] },
            { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [{ IndexName: 'byOwner', IndexStatus: 'ACTIVE' }] },
        )

        await waitUntilActive(store.db, 'pets-test', 1_000, 1)

        expect(store.calls()).toBe(3)
    })

    test('fails with the table and the status when the store never activates it', async () => {
        const store = storeAnswering({
            TableStatus: 'ACTIVE',
            GlobalSecondaryIndexes: [{ IndexName: 'byOwner', IndexStatus: 'CREATING' }],
        })

        const failure = await waitUntilActive(store.db, 'pets-test', 20, 1).catch((e: Error) => e)

        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toContain('pets-test')
        expect((failure as Error).message).toContain('byOwner CREATING')
    })
})

describe('the teardown of a key', () => {
    test('leaves no alias, because a key pending deletion keeps its alias and cannot sign', async () => {
        const aliases = new Set(['alias/proj-data-test'])
        const pending: string[] = []
        const kms = {
            deleteAlias: async ({ AliasName }: { AliasName: string }) => void aliases.delete(AliasName),
            scheduleKeyDeletion: async ({ KeyId }: { KeyId: string }) => void pending.push(KeyId),
        } as unknown as Pick<KMS, 'deleteAlias' | 'scheduleKeyDeletion'>

        await removeKey(kms, 'alias/proj-data-test', 'key-1')

        expect([...aliases]).toEqual([])
        expect(pending).toEqual(['key-1'])
    })
})
