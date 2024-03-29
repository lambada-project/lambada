import * as DynamoDB from "@aws-sdk/client-dynamodb"
import { RepositoryBase } from "../repository";
import { AttributeMap } from "../dynamoMarshaller";

export class RepositoryExtended extends RepositoryBase {

    constructor(...args: ConstructorParameters<typeof RepositoryBase>) {
        super(...args)
    }

    /**
     * Executes a query and filters with a `begins_with` in the sort key
     * @param params 
     * @returns 
     */
    protected async queryBegins_with<T>(params: {
        primaryKey: {
            name: string & keyof T
            value: any
        }
        rangeKey?: {
            name: string & keyof T
            value: any
        }
        indexName?: string,
        limit?: number,
        lastKey?: string,
        scanForward?: boolean

    }): Promise<{ data: T[], lastKey?: string }> {
        const { primaryKey, rangeKey, indexName } = params

        const command: DynamoDB.QueryInput = {
            TableName: this.tableName,
            IndexName: indexName,
            KeyConditionExpression: `#PK = :PK ${rangeKey ? 'AND begins_with(#SK,:SK)' : ''}`,
            ExpressionAttributeNames: {
                '#PK': primaryKey.name,
                ...(rangeKey ? { '#SK': rangeKey.name } : {}),
            },
            ExpressionAttributeValues: {
                ':PK': this.marshaller.marshallValue(primaryKey.value) as DynamoDB.AttributeValue,
                ...(rangeKey ? { ':SK': this.marshaller.marshallValue(rangeKey.value) } : {}),
            },
            Limit: params.limit,
            ScanIndexForward: params.scanForward,
            ExclusiveStartKey: params.lastKey ? JSON.parse(params.lastKey) : undefined,
        }

        const response = await this.getDb().query(command)
        return {
            data: (response.Items ?? []).map(item => this.marshaller.unmarshallItem(item)) as T[],
            lastKey: response.LastEvaluatedKey && JSON.stringify(response.LastEvaluatedKey)
        }
    }

    /**
     * Execute a query with conditional range key.
     * This method is not yet paginated
     * @param params 
     * @returns 
     */
    protected async queryCondition<T>(params: {
        primaryKey: {
            name: string & keyof T
            value: any
        }
        rangeKey?: {
            name: string & keyof T
            value: number | string
            condition: 'EQ' | 'GT' | 'LT' | 'GE' | 'LE' | 'BEGINS_WITH'
        } | {
            name: string & keyof T
            value: {
                from: number | string,
                to: number | string
            }
            condition: 'BETWEEN'
        }
        indexName?: string
        limit?: number
    }): Promise<T[]> {
        const { primaryKey, rangeKey, indexName } = params

        const skCondition: Record<Required<(typeof params)>['rangeKey']['condition'], string> = {
            EQ: 'AND #SK = :SK',
            GT: 'AND #SK > :SK',
            LT: 'AND #SK < :SK',
            GE: 'AND #SK >= :SK',
            LE: 'AND #SK <= :SK',
            BEGINS_WITH: 'AND begins_with(#SK, :SK)',
            BETWEEN: 'AND #SK between :SKfrom and :SKto'
        }

        const command: DynamoDB.QueryInput = {
            TableName: this.tableName,
            IndexName: indexName,
            KeyConditionExpression: `#PK = :PK ${rangeKey ? skCondition[rangeKey.condition] : ''}`,
            ExpressionAttributeNames: {
                '#PK': primaryKey.name,
                ...(rangeKey ? { '#SK': rangeKey.name } : {}),
            },
            ExpressionAttributeValues: {
                ':PK': this.marshaller.marshallValue(primaryKey.value) as any,
                ...(rangeKey ?
                    typeof rangeKey.value === 'object' ?
                        {
                            ':SKfrom': this.marshaller.marshallValue(rangeKey.value.from) as any,
                            ':SKto': this.marshaller.marshallValue(rangeKey.value.to) as any,
                        }
                        : { ':SK': this.marshaller.marshallValue(rangeKey.value) } as any
                    : {}),
            },
            Limit: params.limit
        }

        const response = await this.getDb().query(command)
        return (response.Items ?? []).map(item => this.fromItem<T>(item))
    }


    /**
     * Requires `updateItem` permission
     * @param params update params
     * @returns all updated items
     */
    protected async updateItem<T extends { [key: string]: any }>(params: {
        primaryKey: {
            name: string & keyof T
            value: any
        }
        rangeKey?: {
            name: string & keyof T
            value: any
        }
        update: {
            [key in keyof T]?: any
        }
    }): Promise<T> {
        const { primaryKey, rangeKey, update } = params

        const attributes = Object.entries(update)
        type Require<T, P extends keyof T> = Omit<T, P> & Required<Pick<T, P>>

        const command: Require<DynamoDB.UpdateItemInput, 'ExpressionAttributeNames' | 'ExpressionAttributeValues'> = {
            TableName: this.tableName,
            Key: this.marshaller.marshallItem({
                [primaryKey.name]: primaryKey.value,
                ...(rangeKey ? { [rangeKey.name]: rangeKey.value } : {}),
            }),
            ConditionExpression: `#PK = :PK ${rangeKey ? `AND #SK = :SK` : ''}`,
            UpdateExpression: `set ${attributes.map(([k]) => `#${k} = :${k}`).join(', ')}`,
            ExpressionAttributeNames: {
                '#PK': primaryKey.name,
                ...(rangeKey ? { '#SK': rangeKey.name } : {}),
            },
            ExpressionAttributeValues: {
                ':PK': this.marshaller.marshallValue(primaryKey.value) as DynamoDB.AttributeValue,
                ...(rangeKey
                    ? { ':SK': this.marshaller.marshallValue(rangeKey.value) as DynamoDB.AttributeValue }
                    : {}),
            },

            ReturnValues: 'ALL_NEW',
        }

        attributes.forEach(([name, value]) => {
            command.ExpressionAttributeNames[`#${name}`] = name
            command.ExpressionAttributeValues[`:${name}`] = this.marshaller.marshallValue(
                value,
            ) as DynamoDB.AttributeValue
        })

        const response = await this.getDb().updateItem(command)

        if (!response.Attributes) throw new Error('Failed to update item')

        return this.marshaller.unmarshallItem(response.Attributes) as T
    }

    /**
     * Reads all items of the table
     * @param params 
     * @returns 
     */
    protected async fullScan<T>(params: DynamoDB.ScanInput): Promise<T[]> {
        let lastEvaluatedKey: DynamoDB.ScanCommandOutput['LastEvaluatedKey'] = params.ExclusiveStartKey
        let items: T[] = []
        do {
            const command: DynamoDB.ScanInput = {
                ...params,
                ExclusiveStartKey: lastEvaluatedKey,
            }
            const response = await this.getDb().scan(command)
            lastEvaluatedKey = response.LastEvaluatedKey
            items = items.concat((response.Items ?? []).map(item => this.fromItem<T>(item)))

        } while (lastEvaluatedKey)
        return items
    }

    protected fromItem<T>(item: AttributeMap): T {
        return this.marshaller.unmarshallItem(item) as T
    }
}