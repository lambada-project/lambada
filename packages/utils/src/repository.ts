import * as AWS from "aws-sdk"
import { AttributeValue, AttributeMap } from 'aws-sdk/clients/dynamodb'
import { ConditionExpression, ExpressionAttributeValueMap, PutItemInput, QueryInput, Key } from "aws-sdk/clients/dynamodb"

export interface IMarshaller {
    marshallItem(item: {
        [key: string]: any;
    }): AttributeMap;

    marshallValue(value: any): AttributeValue | undefined;
    unmarshallItem(item: AttributeMap): any;

    unmarshallValue(item: AttributeValue): any;
}

export const DefaultMarshaller: IMarshaller = {
    marshallItem: AWS.DynamoDB.Converter.marshall,
    unmarshallItem: AWS.DynamoDB.Converter.unmarshall,
    marshallValue: AWS.DynamoDB.Converter.input,
    unmarshallValue: AWS.DynamoDB.Converter.output,
}

export class RepositoryBase {
    protected marshaller: IMarshaller

    protected readonly tableName: string

    protected clientConfig?: AWS.DynamoDB.ClientConfiguration

    constructor(
        protected readonly table: {
            envKeyName: string
            name: string
            primaryKey: string
            rangeKey?: string
        },
        customMarshaller?: IMarshaller,
        clientConfig?: AWS.DynamoDB.ClientConfiguration
    ) {
        this.tableName = process.env[this.table.envKeyName] ?? ''
        if (customMarshaller) {
            this.marshaller = customMarshaller
        } else {
            this.marshaller = DefaultMarshaller
        }
        this.clientConfig = clientConfig
    }

    /**
     * Validates the table data before execution. This is important because if you've got more than one repo in a single service class,
     * and a lambda that only uses one of them, then it would fail because it's expecting config for both tables, even if using one only. 
     * That's because the resource access given to each lambda also sets he environment variables needed.
     */
    protected getDb() {
        if (!this.tableName || this.tableName.length < 3) //AWS rule
            throw new Error(`Could not find env var: ${this.table.envKeyName}`)
        return new AWS.DynamoDB(this.clientConfig)
    }

    protected async scan<T>(args?: {
        filter?: ConditionExpression,
        filterValues?: ExpressionAttributeValueMap
    }) {
        const db = this.getDb()

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
        const db = this.getDb()

        const marsharlledItem = this.marshaller.marshallItem(item as any)

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
        },
        rangeKey?: {
            name: string,
            value: any
        } | string,
        indexName?: string
    ): Promise<T[]> {

        if (typeof rangeKey === 'string') {
            indexName = rangeKey
            rangeKey = undefined
        }

        const db = this.getDb()

        const value = this.marshaller.marshallValue(primaryKey.value)
        if (!value) throw new Error(`Invalid primary key. ${JSON.stringify(primaryKey)}`)


        let params: QueryInput = {
            TableName: this.tableName,
            KeyConditionExpression: "#primaryKey = :primaryKeyValue",
            ExpressionAttributeNames: {
                "#primaryKey": primaryKey.name
            },
            ExpressionAttributeValues: {
                ":primaryKeyValue": value
            },
            IndexName: indexName
        };

        if (rangeKey?.name && rangeKey?.value && params.ExpressionAttributeNames && params.ExpressionAttributeValues) {
            params.KeyConditionExpression += " AND #rangeKey = :rangeKeyValue"
            params.ExpressionAttributeNames["#rangeKey"] = rangeKey.name
            params.ExpressionAttributeValues[":rangeKeyValue"] = this.marshaller.marshallValue(rangeKey.value) as any
        }


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
        const db = this.getDb()

        let value = this.marshaller.marshallValue(primaryKey.value)
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
            Key: key,
            ConsistentRead: true,
        }).promise()

        if (!item.Item) return null
        return this.marshaller.unmarshallItem(item.Item) as unknown as T
    }

}