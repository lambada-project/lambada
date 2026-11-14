import type { CreateTableInput, DynamoDB, TableDescription } from '@aws-sdk/client-dynamodb'
import type { KMS } from '@aws-sdk/client-kms'
import type { LambadaTables } from '../database/index'

/** The table, as the runner creates it. On demand, so a store that enforces provisioned units does not throttle a test. */
export const tableInput = (table: LambadaTables[string], tableName: string): CreateTableInput => ({
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
        {
            AttributeName: table.primaryKey,
            AttributeType: 'S'
        },
        table.rangeKey ?
            {
                AttributeName: table.rangeKey,
                AttributeType: 'S'
            } : undefined,
        ...(table.attributes ?? []).map(x => ({
            AttributeName: x.name,
            AttributeType: x.type
        }))

    ].filter(x => typeof x !== 'undefined'),
    KeySchema: [
        {
            AttributeName: table.primaryKey,
            KeyType: 'HASH'
        },
        table.rangeKey ?
            {
                AttributeName: table.rangeKey,
                KeyType: 'RANGE'
            } : undefined
    ].filter(x => typeof x !== 'undefined'),
    GlobalSecondaryIndexes: table.indexes?.map(x => ({
        IndexName: x.name,
        KeySchema: [
            { AttributeName: x.hashKey, KeyType: "HASH" }, //Partition key
            ...(x.rangeKey ? [{ AttributeName: x.rangeKey, KeyType: "RANGE" }] : [])
        ],
        Projection: {
            ProjectionType: x.projectionType,
            NonKeyAttributes: x.projectionType == 'INCLUDE' ? x.nonKeyAttributes : undefined
        }
    }))
} as CreateTableInput)

/** A table takes writes when it and each of its indexes are ACTIVE. */
export const isActive = (table: TableDescription | undefined): boolean =>
    table?.TableStatus === 'ACTIVE' && (table.GlobalSecondaryIndexes ?? []).every(x => x.IndexStatus === 'ACTIVE')

const statuses = (table: TableDescription | undefined) =>
    [`table ${table?.TableStatus}`, ...(table?.GlobalSecondaryIndexes ?? []).map(x => `${x.IndexName} ${x.IndexStatus}`)].join(', ')

/**
 * Polls until the table and each index are ACTIVE. A store can answer CreateTable before it activates the table.
 * The SDK waiter waitUntilTableExists is not used: it reads the status of the table and not the status of a GSI.
 */
export async function waitUntilActive(db: DynamoDB, tableName: string, timeoutMs = 60_000, intervalMs = 100): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let last: TableDescription | undefined
    do {
        last = (await db.describeTable({ TableName: tableName })).Table
        if (isActive(last)) return
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    } while (Date.now() < deadline)
    throw new Error(`Table ${tableName} is not ACTIVE after ${timeoutMs} ms (${statuses(last)})`)
}

/** The alias goes first: a key pending deletion keeps its alias, and the next setup would reuse a key that cannot sign. */
export async function removeKey(kms: Pick<KMS, 'deleteAlias' | 'scheduleKeyDeletion'>, alias: string, keyId: string): Promise<void> {
    await kms.deleteAlias({ AliasName: alias })
    await kms.scheduleKeyDeletion({ KeyId: keyId })
}
