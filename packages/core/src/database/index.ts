import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { dynamodb } from '@pulumi/aws/types/input'
import * as awsx from "@pulumi/awsx";
import { seedData } from './seedData'
import { SecurityResult } from "../security";

function createTable(name: string, environment: string, primaryKeyName: string, rangeKeyName?: string, kmsKey?: aws.kms.Key, secondaryIndexes?: TableIndexDefinition[]) {
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
        ],
        billingMode: "PAY_PER_REQUEST",
        hashKey: primaryKeyName,
        rangeKey: rangeKeyName,
        //readCapacity: 20,
        tags: {
            Environment: environment,
        },
        // ttl: {
        //     attributeName: "TimeToExist",
        //     enabled: false,
        // },
        globalSecondaryIndexes: secondaryIndexes,
        //writeCapacity: 20,
        serverSideEncryption: {
            enabled: kmsKey ? true : false,
            kmsKeyArn: kmsKey ? kmsKey.arn : undefined
        }

    })
}

function findTable(name: string, environment: string): pulumi.Output<TableReference> {
    const tableName = `${name}-${environment}`
    return pulumi.output(aws.dynamodb.getTable({
        name: tableName,
    }, { async: true }));
}

export type TableIndexDefinition = dynamodb.TableGlobalSecondaryIndex
// {
//     name: string //"contactNameIndex",
//     hashKey: string //"contactName",
//     nonKeyAttributes: string[] //["userId"],
//     projectionType: "INCLUDE",
//     rangeKey: "contactName",
//     readCapacity: 10,
//     writeCapacity: 10,
// }

export type TableDefinition = {
    name: string
    primaryKey: string
    rangeKey?: string
    envKeyName: string
    data?: (string | object)[]
    indexes?: TableIndexDefinition[]
}

export type EmbroideryTables = { [id: string]: TableDefinition }

export const createDynamoDbTables = (environment: string, tables: EmbroideryTables, prefix?: string, kmsKeys?: SecurityResult, tableRefs?: EmbroideryTables): DatabaseResult => {

    const result: any = {}
    for (const key in tables) {
        if (Object.prototype.hasOwnProperty.call(tables, key)) {
            const table = tables[key];
            const tableName = prefix && prefix.length > 0 ? `${prefix}-${table.name}` : table.name
            const awsTable = createTable(tableName, environment, table.primaryKey, table.rangeKey, kmsKeys?.dynamodb?.awsKmsKey, table.indexes)
            result[key] = {
                ref: {
                    id: awsTable.id,
                    arn: awsTable.arn,
                    name: awsTable.name,
                    hashKey: awsTable.hashKey
                },
                awsTable: awsTable,
                definition: table,
                kmsKey: kmsKeys?.dynamodb?.awsKmsKey
            } as DatabaseResultItem
        }
    }
    for (const key in tableRefs) {
        if (Object.prototype.hasOwnProperty.call(tableRefs, key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref table with the same name of an existing table: ${key}`)
            }

            const table = tableRefs[key];
            result[key] = {
                ref: findTable(table.name, environment),
                definition: table,
                kmsKey: kmsKeys?.dynamodb?.awsKmsKey
            } as DatabaseResultItem
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
    kmsKey: aws.kms.Key
}
export type DatabaseResult = { [id: string]: DatabaseResultItem }