import * as DynamoDB from "@aws-sdk/client-dynamodb"
import { IMarshaller, DefaultMarshaller } from "./dynamoMarshaller";

export class RepositoryBase {
    protected marshaller: IMarshaller

    protected readonly tableName: string

    protected clientConfig?: DynamoDB.DynamoDBClientConfig

    constructor(
        protected readonly table: {
            envKeyName: string
            name: string
            primaryKey: string
            rangeKey?: string
        },
        customMarshaller?: IMarshaller,
        clientConfig?: DynamoDB.DynamoDBClientConfig
    ) {
        this.tableName = process.env[table.envKeyName] ?? table.name ?? '';
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
        if (this.clientConfig?.region) { // WTF https://github.com/aws/aws-sdk-js-v3/issues/3469#issuecomment-1078404172
            process.env['AWS_REGION'] = this.clientConfig.region.toString()
        }
        return new DynamoDB.DynamoDB(this.clientConfig ?? {})
    }

    protected async scan<T>(args?: {
        filter?: string,
        filterValues?: Record<string, DynamoDB.AttributeValue>
    }) {
        const db = this.getDb()

        const result = await db.scan({
            TableName: this.tableName,
            FilterExpression: args?.filter,
            ExpressionAttributeValues: args?.filterValues,
        })

        if (!result.Items) {
            return []
        }

        return result.Items?.map((x) => this.marshaller.unmarshallItem(x) as unknown as T)
    }


    protected async upsert<T>(item: T): Promise<T> {
        const db = this.getDb()

        const marsharlledItem = this.marshaller.marshallItem(item as any)

        const command: DynamoDB.PutItemInput = {
            Item: marsharlledItem,
            TableName: this.tableName,
            ReturnValues: 'NONE'
        }

        await db.putItem(command)

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


        let params: DynamoDB.QueryInput = {
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


        const result = await db.query(params)
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

        const key: Record<string, DynamoDB.AttributeValue> | undefined = {
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
        })

        if (!item.Item) return null
        return this.marshaller.unmarshallItem(item.Item) as T
    }

}