import DynamoDB, { ExpressionAttributeNameMap, ExpressionAttributeValueMap } from "aws-sdk/clients/dynamodb";
import { RepositoryBase } from "../repository";

export class RepositoryExtended extends RepositoryBase {

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
        lastKey?: string

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
            ExclusiveStartKey: params.lastKey ? JSON.parse(params.lastKey) : undefined,
        }

        const response = await this.getDb().query(command).promise()
        return {
            data: (response.Items ?? []).map(item => this.marshaller.unmarshallItem(item)),
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
        }

        const response = await this.getDb().query(command).promise()
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

        const response = await this.getDb().updateItem(command).promise()

        if (!response.Attributes) throw new Error('Failed to update item')

        return this.marshaller.unmarshallItem(response.Attributes) as T
    }


    private fromItem<T>(item: DynamoDB.AttributeMap): T {
        return this.marshaller.unmarshallItem(item) as T
    }
}