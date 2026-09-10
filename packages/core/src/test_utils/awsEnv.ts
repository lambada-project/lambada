import { LambadaTables } from '../database/index'
import { CreateTableInput, DynamoDB, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { KMS, KMSClientConfig } from '@aws-sdk/client-kms'
import { SQS, SQSClientConfig } from '@aws-sdk/client-sqs'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import type { SNSClientConfig } from '@aws-sdk/client-sns'
import type { SecretsManagerClientConfig } from '@aws-sdk/client-secrets-manager'
import { LambadaBuckets } from '../buckets';
import { LambadaMessages } from '../messaging';
import { LambadaQueues } from '../queue';
import { EmbroiderySecrets, SecurityKeys } from '../security';
import { Input } from '@pulumi/pulumi';
type AWSOptionTypes = {
    dynamodb?: DynamoDBClientConfig
    kms?: KMSClientConfig
    s3?: S3ClientConfig
    sns?: SNSClientConfig
    sqs?: SQSClientConfig
    secretsmanager?: SecretsManagerClientConfig
}

let currentAWSConfig: AWSOptionTypes;
export type LambadaEnvironmentConfig = {
    options?: {
        aws?: AWSOptionTypes,
        /**
         * What run() would prefix each physical name with. Absent leaves the bare definition name,
         * which is what this runner has always created.
         */
        projectName?: string
        environment?: string
        tablePrefix?: string
        tables?: LambadaTables
        buckets?: LambadaBuckets
        messages?: LambadaMessages
        queues?: LambadaQueues
        secrets?: EmbroiderySecrets
        keys?: SecurityKeys
    }
}

/** LocalStack answers a second create with a conflict; the resource being there is the point. */
const ifNotAlreadyThere = () => undefined

/** The physical name run() would deploy, degrading to the bare name when the stack is not named. */
export const physical = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('-')


export async function ConfigureAwsEnvironment({ options }: LambadaEnvironmentConfig): Promise<void> {

    currentAWSConfig = options?.aws ?? {}
    const { projectName, environment, tablePrefix } = options ?? {}
    const tables = options?.tables
    const keys = options?.keys

    process.env.AWS_REGION = (currentAWSConfig.dynamodb?.region ?? currentAWSConfig.kms?.region ?? '').toString()
    const delay = () => new Promise((resolve) => setTimeout(resolve, 200))

    if (tables) {
        const db = new DynamoDB(currentAWSConfig?.dynamodb ?? {})

        const existingTableNames = (await db.listTables({})).TableNames ?? []
        await delay()

        validateTables(tables)

        for (const key in tables) {

            if (tables.hasOwnProperty(key)) {
                const table = tables[key];
                const tableName = physical(tablePrefix, table.name, environment)
                process.env[table.envKeyName] = tableName
                if (existingTableNames.includes(tableName)) {
                    continue;
                }
                await db.createTable({
                    TableName: tableName,
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
    }

    if (keys) {

        const kms = new KMS(currentAWSConfig.kms ?? {});

        const existingKeys = (await kms.listAliases({})).Aliases ?? []

        for (const key in keys) {
            if (keys.hasOwnProperty(key)) {
                const keyConfig = keys[key]!
                const alias = `alias/${physical(projectName, keyConfig.name, environment)}`
                const existingKey = existingKeys.find((x) => x.AliasName === alias)
                if (existingKey) {
                    // The grant publishes the ARN, so a handler must read the same here.
                    const described = await kms.describeKey({ KeyId: existingKey.TargetKeyId })
                    process.env[keyConfig.envKeyName] = described.KeyMetadata?.Arn
                    continue
                }
                const result = await kms.createKey({
                    KeySpec: keyConfig.options?.customerMasterKeySpec?.toString() as never,
                    KeyUsage: keyConfig.options?.keyUsage?.toString() as never,
                })

                process.env[keyConfig.envKeyName] = result.KeyMetadata?.Arn
                await kms.createAlias({
                    AliasName: alias,
                    TargetKeyId: result.KeyMetadata?.KeyId,
                })
            }
        }
    }

    const buckets = options?.buckets
    if (buckets) {
        const { S3 } = await import('@aws-sdk/client-s3')
        const s3 = new S3(currentAWSConfig.s3 ?? {})

        for (const key in buckets) {
            const bucket = physical(buckets[key].name, environment)
            process.env[buckets[key].envKeyName] = bucket
            await s3.createBucket({ Bucket: bucket }).catch(ifNotAlreadyThere)
        }
    }

    const messages = options?.messages
    if (messages) {
        const { SNS } = await import('@aws-sdk/client-sns')
        const sns = new SNS(currentAWSConfig.sns ?? {})

        for (const key in messages) {
            const name = physical(messages[key].name, environment)
            const created = await sns.createTopic({ Name: name })
            // The grant publishes the topic ARN.
            process.env[messages[key].envKeyName] = created.TopicArn
        }
    }

    const queues = options?.queues
    if (queues) {
        const sqs = new SQS(currentAWSConfig.sqs ?? {})

        for (const key in queues) {
            const fifo = queues[key].options?.fifoQueue ? '.fifo' : ''
            const name = `${physical(queues[key].name, environment)}${fifo}`
            const created = await sqs.createQueue({
                QueueName: name,
                Attributes: fifo ? { FifoQueue: 'true' } : undefined,
            })
            // The grant publishes the queue URL.
            process.env[queues[key].envKeyName] = created.QueueUrl
        }
    }

    const secrets = options?.secrets
    if (secrets) {
        const { SecretsManager } = await import('@aws-sdk/client-secrets-manager')
        const secretsManager = new SecretsManager(currentAWSConfig.secretsmanager ?? {})

        for (const key in secrets) {
            const name = physical(projectName, secrets[key].name, environment)
            process.env[secrets[key].envKeyName] = name
            await secretsManager.createSecret({ Name: name }).catch(ifNotAlreadyThere)
        }
    }
}

export async function RemoveResources(config: LambadaEnvironmentConfig): Promise<void> {

    const { projectName, environment, tablePrefix } = config.options ?? {}
    const tables = config.options?.tables
    if (tables) {
        const db = new DynamoDB(config.options?.aws?.dynamodb ?? {})

        const existingTableNames = (await db.listTables({})).TableNames ?? []

        for (const tableKey of Object.keys(tables)) {
            const tableName = physical(tablePrefix, tables[tableKey].name, environment)
            if (existingTableNames.includes(tableName)) {
                await db.deleteTable({
                    TableName: tableName,
                });
            }
        }
    }

    const buckets = config.options?.buckets
    if (buckets) {
        const { S3 } = await import('@aws-sdk/client-s3')
        const s3 = new S3(currentAWSConfig.s3 ?? {})

        for (const key in buckets) {
            const Bucket = physical(buckets[key].name, environment)
            const listed = await s3.listObjectsV2({ Bucket }).catch(() => undefined)

            for (const object of listed?.Contents ?? []) {
                await s3.deleteObject({ Bucket, Key: object.Key! })
            }
            await s3.deleteBucket({ Bucket }).catch(() => undefined)
        }
    }

    const messages = config.options?.messages
    if (messages) {
        const { SNS } = await import('@aws-sdk/client-sns')
        const sns = new SNS(currentAWSConfig.sns ?? {})
        const existing = (await sns.listTopics({})).Topics ?? []

        for (const key in messages) {
            const name = physical(messages[key].name, environment)
            const topic = existing.find(x => x.TopicArn?.endsWith(`:${name}`))

            if (topic?.TopicArn) await sns.deleteTopic({ TopicArn: topic.TopicArn })
        }
    }

    const queues = config.options?.queues
    if (queues) {
        const sqs = new SQS(currentAWSConfig.sqs ?? {})

        for (const key in queues) {
            const fifo = queues[key].options?.fifoQueue ? '.fifo' : ''
            const name = `${physical(queues[key].name, environment)}${fifo}`
            const found = await sqs.getQueueUrl({ QueueName: name }).catch(() => undefined)

            if (found?.QueueUrl) await sqs.deleteQueue({ QueueUrl: found.QueueUrl })
        }
    }

    const secrets = config.options?.secrets
    if (secrets) {
        const { SecretsManager } = await import('@aws-sdk/client-secrets-manager')
        const secretsManager = new SecretsManager(currentAWSConfig.secretsmanager ?? {})

        for (const key in secrets) {
            const SecretId = physical(projectName, secrets[key].name, environment)
            await secretsManager.deleteSecret({ SecretId, ForceDeleteWithoutRecovery: true }).catch(() => undefined)
        }
    }

    const keys = config.options?.keys
    if (keys) {

        const kms = new KMS(currentAWSConfig.kms ?? {});

        const existingKeys = (await kms.listAliases({})).Aliases ?? []

        for (const key in keys) {
            if (keys.hasOwnProperty(key)) {
                const keyConfig = keys[key]!
                const alias = `alias/${physical(projectName, keyConfig.name, environment)}`
                const existingKey = existingKeys.find((x) => x.AliasName === alias)
                if (existingKey) {
                    // Deleting key also deletes aliases
                    await kms.scheduleKeyDeletion({
                        KeyId: existingKey.TargetKeyId
                    })
                }
            }
        }
    }
}

function validateTables(tables: LambadaTables): asserts tables is LambadaTables {
    const isString = (s: string | undefined | Input<string | undefined> ): s is string => typeof s === 'string'
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