import * as AWS from 'aws-sdk'

import { EmbroideryTables } from '../database/index'
import { CreateTableInput } from 'aws-sdk/clients/dynamodb';

export async function ConfigureAwsEnvironment(tables: EmbroideryTables): Promise<void> {

    AWS.config.update(
        {
            region: 'eu-west-1',
            accessKeyId: '123',
            secretAccessKey: '321',
            dynamodb: {
                endpoint: 'http://dynamo:8000'
            }
        });
    const db = new AWS.DynamoDB()

    const existingTableNames = (await db.listTables().promise()).TableNames ?? []
    const delay = () => new Promise((resolve) => setTimeout(resolve, 1000))
    await delay()

    for (const key in tables) {

        if (tables.hasOwnProperty(key)) {
            const table = tables[key];
            process.env[table.envKeyName] = table.name
            if (existingTableNames.includes(table.name)) {
                //     // await db.deleteTable({
                //     //     TableName: table.name,
                //     // }).promise()
                //     // await delay()
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
                        } : undefined
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
                        //NonKeyAttributes: x.nonKeyAttributes // TODO :D
                    }
                }))

            } as CreateTableInput).promise()
        }
    }

    // const repo = new DynamoDBCurrencyRepository();
    // await repo.seed()


    //TODO: lists topics, somehow without querying SNS
    // const sns = new AWS.SNS()
    // const topics = await sns.listTopics().promise()
    // const topicArns = topics.Topics?.filter(x => x.TopicArn).map(x => x.TopicArn ?? '') ?? []
    // for (const topicArn of topicArns) {
    //     if(topicArn.includes('offerCreated')){
    //         process.env['ORDERBOOK_OFFER_CREATED_TOPIC_ARN'] = topicArn
    //     }
    // }
}