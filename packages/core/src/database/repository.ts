import * as AWS from "aws-sdk"
import { ConditionExpression, ExpressionAttributeValueMap, PutItemInput, QueryInput, Key } from "aws-sdk/clients/dynamodb"
import { Marshaller } from '@aws/dynamodb-auto-marshaller'
import { TableDefinition } from ".";


export class RepositoryBase {
    protected marshaller = new Marshaller();

    protected readonly tableName: string
    constructor(protected readonly table: TableDefinition) {
        const name = process.env[this.table.envKeyName]
        if (name && name.length >= 3) //AWS rule
            this.tableName = name
        else
            throw new Error('Invalid table name')

    }

    protected async scan<T>(args?: {
        filter?: ConditionExpression,
        filterValues?: ExpressionAttributeValueMap
    }) {
        const db = new AWS.DynamoDB()
        const result = await db.scan({
            TableName: this.tableName,
            FilterExpression: args?.filter,
            ExpressionAttributeValues: args?.filterValues,
        }).promise()

        if (!result.Items) {
            return []
        }

        return result.Items?.map((x) => this.marshaller.unmarshallItem(x) as unknown as T)
    }


    protected async upsert<T>(item: T): Promise<T> {
        const db = new AWS.DynamoDB()

        const marsharlledItem = this.marshaller.marshallItem(item)

        const command: PutItemInput = {
            Item: marsharlledItem,
            TableName: this.tableName,
            ReturnValues: 'NONE'
        }

        await db.putItem(command).promise()

        return item
    }


    protected async query<T>(
        primaryKey: {
            name: string,
            value: any
        }
    ): Promise<T[]> {
        const db = new AWS.DynamoDB()

        const value = this.marshaller.marshallValue(primaryKey.value)
        if (!value) throw new Error(`Invalid primary key. ${JSON.stringify(primaryKey)}`)

        var params: QueryInput = {
            TableName: this.tableName,
            KeyConditionExpression: "#primaryKey = :primaryKeyValue",
            ExpressionAttributeNames: {
                "#primaryKey": primaryKey.name
            },
            ExpressionAttributeValues: {
                ":primaryKeyValue": value
            }
        };
        const result = await db.query(params).promise()
        const items = result.Items
        if (!items) return []
        return items.map(item => this.marshaller.unmarshallItem(item) as unknown as T)
    }

    protected async getById<T>(
        primaryKey: {
            name: string,
            value: any
        },
        rangeKey?: {
            name: string,
            value: any
        }
    ) {
        const db = new AWS.DynamoDB()
        var value = this.marshaller.marshallValue(primaryKey.value)
        if (!value) throw new Error(`Invalid primary key. ${JSON.stringify(primaryKey)}`)

        const key: Key = {
            [primaryKey.name]: value
        }

        if (rangeKey) {
            const range = this.marshaller.marshallValue(rangeKey.value)
            if (!range) throw new Error(`Invalid range key. ${JSON.stringify(primaryKey)}`)
            key[rangeKey.name] = range
        }

        const item = await db.getItem({
            TableName: this.tableName,
            Key: key
        }).promise()

        if (!item.Item) return null
        return this.marshaller.unmarshallItem(item.Item) as unknown as T
    }

}