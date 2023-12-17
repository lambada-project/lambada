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

    for (const key of existingTableNames) {

        if (tables.hasOwnProperty(key)) {
            const table = tables[key];
            await db.deleteTable({
                TableName: table.name,
            })
        }
    }
}