import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { dynamodb } from '@pulumi/aws/types/input'
import * as awsx from "@pulumi/awsx/classic";
import { seedData } from './seedData'
import { SecurityResult } from "../security";

export type TableAttribute = dynamodb.TableAttribute
type TableOptions = {
    pointInTimeRecoveryEnabled?: boolean,
    streamEnabled?: boolean,
    streamViewType?: `KEYS_ONLY` | `NEW_IMAGE` | `OLD_IMAGE` | `NEW_AND_OLD_IMAGES`
}

function createTable(
    name: string,
    environment: string,
    primaryKeyName: string,
    rangeKeyName?: string,
    kmsKey?: aws.kms.Key,
    attributes?: TableAttribute[],
    secondaryIndexes?: TableIndexDefinition[],
    ttl?: { attributeName: string, enabled: boolean },
    options?: TableOptions
) {
    const tableName = `${name}-${environment}`

    return new aws.dynamodb.Table(tableName, {
        name: tableName,
        attributes: [
            {
                name: primaryKeyName,
                type: "S",
            },
            ...(rangeKeyName ?
                [{
                    name: rangeKeyName,
                    type: "S",
                }] : []
            ),
            ...(attributes ?? [])
        ],
        billingMode: "PAY_PER_REQUEST",
        hashKey: primaryKeyName,
        rangeKey: rangeKeyName,
        //readCapacity: 20,
        tags: {
            Environment: environment,
        },
        ttl: ttl ? {
            attributeName: ttl.attributeName,
            enabled: ttl.enabled
        } : undefined,
        globalSecondaryIndexes: secondaryIndexes,
        //writeCapacity: 20,
        serverSideEncryption: {
            enabled: kmsKey ? true : false,
            kmsKeyArn: kmsKey ? kmsKey.arn : undefined
        },
        pointInTimeRecovery: options?.pointInTimeRecoveryEnabled ? {
            enabled: options?.pointInTimeRecoveryEnabled ?? false
        } : undefined,
        streamEnabled: options?.streamEnabled,
        streamViewType: options?.streamEnabled ? options?.streamViewType : undefined
    })
}

function findTable(name: string, environment: string): pulumi.Output<TableReference> {
    const tableName = `${name}-${environment}`
    return pulumi.output(aws.dynamodb.getTable({
        name: tableName,
    }, { async: true }));
}

export type TableIndexDefinition = dynamodb.TableGlobalSecondaryIndex


export type TableDefinition = {
    name: string
    primaryKey: string
    rangeKey?: string
    envKeyName: string
    data?: (string | object)[]
    indexes?: TableIndexDefinition[]
    attributes?: TableAttribute[]
    ttl?: { attributeName: string, enabled: boolean },
    options?: TableOptions
}

export type EmbroideryTables = { [id: string]: TableDefinition }

export const createDynamoDbTables = (environment: string, tables?: EmbroideryTables, prefix?: string, kmsKeys?: SecurityResult, tableRefs?: EmbroideryTables | DatabaseResult): DatabaseResult => {

    const result: DatabaseResult = {}
    for (const key in tables) {
        if (Object.prototype.hasOwnProperty.call(tables, key)) {
            const table = tables[key];
            const tableName = prefix && prefix.length > 0 ? `${prefix}-${table.name}` : table.name
            const awsTable = createTable(
                tableName, environment, table.primaryKey, table.rangeKey,
                kmsKeys?.dynamodb?.awsKmsKey,
                table.attributes, table.indexes, table.ttl,
                table.options
            )

            result[key] = {
                ref: pulumi.Output.create({
                    id: awsTable.id,
                    arn: awsTable.arn,
                    name: awsTable.name,
                    hashKey: awsTable.hashKey
                }),
                awsTable: awsTable,
                definition: table,
                kmsKey: kmsKeys?.dynamodb?.awsKmsKey
            } satisfies DatabaseResultItem
        }
    }
    for (const key in tableRefs) {
        if (Object.prototype.hasOwnProperty.call(tableRefs, key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref table with the same name of an existing table: ${key}`)
            }
            const table = tableRefs[key];

            function isRef(obj: DatabaseResultItem | TableDefinition): obj is DatabaseResultItem {
                return !!(( obj as DatabaseResultItem ).awsTable && ( obj as DatabaseResultItem ).ref)
            }

            if (isRef(table)) {
                result[key] = table
            } else {
                result[key] = {
                    ref: findTable(table.name, environment),
                    definition: table,
                    kmsKey: kmsKeys?.dynamodb?.awsKmsKey
                } as DatabaseResultItem
            }
        }
    }

    seedData(result)
    return result;
}

type TableReference = {
    name: string
    id: string
    arn: string
    hashKey: string;
}

export type DatabaseResultItem = {
    awsTable?: aws.dynamodb.Table
    ref: pulumi.Output<TableReference>
    definition: TableDefinition
    kmsKey?: aws.kms.Key
}
export type DatabaseResult = { [id: string]: DatabaseResultItem }