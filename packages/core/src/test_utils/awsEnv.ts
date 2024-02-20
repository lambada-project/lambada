import { EmbroideryTables } from '../database/index'
import { CreateTableInput, DynamoDB, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
type AWSOptionTypes = { dynamodb?: DynamoDBClientConfig }

let currentAWSConfig: AWSOptionTypes;
export type LambadaEnvironmentConfig = {
    options?: {
        aws?: AWSOptionTypes,
        tables?: EmbroideryTables
    }
}


export async function ConfigureAwsEnvironment({ options }: LambadaEnvironmentConfig): Promise<void> {

    currentAWSConfig = options?.aws ?? {}
    const tables = options?.tables ?? {};

    process.env.AWS_REGION = currentAWSConfig.dynamodb?.region?.toString() ?? ''
    const db = new DynamoDB(currentAWSConfig?.dynamodb ?? {})

    const existingTableNames = (await db.listTables({})).TableNames ?? []
    const delay = () => new Promise((resolve) => setTimeout(resolve, 200))
    await delay()

    validateTables(tables)

    for (const key in tables) {

        if (tables.hasOwnProperty(key)) {
            const table = tables[key];
            process.env[table.envKeyName] = table.name
            if (existingTableNames.includes(table.name)) {
                continue;
            }
            await db.createTable({
                TableName: table.name,
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
                ProvisionedThroughput: {
                    ReadCapacityUnits: 10,
                    WriteCapacityUnits: 10
                },
                GlobalSecondaryIndexes: table.indexes?.map(x => ({
                    IndexName: x.name,
                    KeySchema: [
                        { AttributeName: x.hashKey, KeyType: "HASH" }, //Partition key
                        ...(x.rangeKey ? [{ AttributeName: x.rangeKey, KeyType: "RANGE" }] : [])
                    ],
                    Projection: {
                        ProjectionType: x.projectionType,
                        NonKeyAttributes: x.projectionType == 'INCLUDE' ? x.nonKeyAttributes : undefined
                    },
                    ProvisionedThroughput: {
                        ReadCapacityUnits: 10,
                        WriteCapacityUnits: 10
                    }
                }))

            } as CreateTableInput)
        }
    }

    // const repo = new DynamoDBCurrencyRepository();
    // await repo.seed()


    //TODO: lists topics, somehow without querying SNS
    // const sns = new AWS.SNS()
    // const topics = await sns.listTopics()
    // const topicArns = topics.Topics?.filter(x => x.TopicArn).map(x => x.TopicArn ?? '') ?? []
    // for (const topicArn of topicArns) {
    //     if(topicArn.includes('offerCreated')){
    //         process.env['ORDERBOOK_OFFER_CREATED_TOPIC_ARN'] = topicArn
    //     }
    // }
}

export async function RemoveResources(config: LambadaEnvironmentConfig): Promise<void> {
    const db = new DynamoDB(config.options?.aws?.dynamodb ?? {})
    const tables = config.options?.tables ?? {};

    const existingTableNames = (await db.listTables({})).TableNames ?? []

    for (const tableKey of Object.keys(tables)) {
        const table = tables[tableKey];
        if (existingTableNames.includes(table.name)) {
            await db.deleteTable({
                TableName: table.name,
            });
        }
    }
}

function validateTables(tables: EmbroideryTables): asserts tables is EmbroideryTables {
    const isString = (s?: string | EmbroideryTables[string]['primaryKey'] | Required<EmbroideryTables[string]>['attributes'][number]['name']): s is string => typeof s === 'string'
    for (const tableKey in tables) {
        const table = tables[tableKey]
        const tableKeys = [table.primaryKey, table.rangeKey,].filter(isString)
        const extraKeys = (table.attributes?.map(a => a.name) ?? []).filter(isString)
        const indexAttributes = (table.indexes?.flatMap(i => [i.hashKey, i.rangeKey]) ?? []).filter(isString)

        // if some extra keys are not in the table keys or index attributes, then it's invalid
        extraKeys.forEach(key => {
            if (!tableKeys.includes(key) && !indexAttributes.includes(key)) {
                throw new Error(`Extra keys in table ${table.name} are not in the table keys or index attributes: ${key}`)
            }
        });

        // if some index attributes are not in the table keys or extra keys, then it's invalid
        indexAttributes.forEach(key => {
            if (!tableKeys.includes(key) && !extraKeys.includes(key)) {
                throw new Error(`Index attributes in table ${table.name} are not in the table keys or extra keys: ${key}`)
            }
        });
    }
} 