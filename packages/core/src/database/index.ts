import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { seedData } from './seedData'
import { SecurityResult } from "../security";

function createTable(name: string, environment: string, primaryKeyName: string, rangeKeyName?: string, kmsKey?: aws.kms.Key) {
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
        // globalSecondaryIndexes: [{
        //     hashKey: "contactName",
        //     name: "contactNameIndex",
        //     nonKeyAttributes: ["userId"],
        //     projectionType: "INCLUDE",
        //     rangeKey: "contactName",
        //     readCapacity: 10,
        //     writeCapacity: 10,
        // }],
        //writeCapacity: 20,
        serverSideEncryption: {
            enabled: kmsKey ? true : false,
            kmsKeyArn: kmsKey ? kmsKey.arn : undefined
        }

    })
}

export type TableDefinition = {
    name: string
    primaryKey: string
    rangeKey?: string
    envKeyName: string
    data?: (string | object)[]
}

export type EmbroideryTables = { [id: string]: TableDefinition }

export const createDynamoDbTables = (environment: string, tables: EmbroideryTables, prefix?: string, kmsKeys?: SecurityResult): DatabaseResult => {

    const result: any = {}
    for (const key in tables) {
        if (tables.hasOwnProperty(key)) {
            const table = tables[key];
            const tableName = prefix && prefix.length > 0 ? `${prefix}-${table.name}` : table.name
            result[key] = {
                awsTable: createTable(tableName, environment, table.primaryKey, table.rangeKey, kmsKeys?.dynamodb?.awsKmsKey),
                definition: table,
                kmsKey: kmsKeys?.dynamodb?.awsKmsKey
            } as DatabaseResultItem
        }
    }
    seedData(result)
    return result;
}

export type DatabaseResultItem = {
    awsTable: aws.dynamodb.Table
    definition: TableDefinition
    kmsKey: aws.kms.Key
}
export type DatabaseResult = { [id: string]: DatabaseResultItem }