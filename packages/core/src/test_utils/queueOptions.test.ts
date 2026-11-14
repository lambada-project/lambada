import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { ConfigureAwsEnvironment } from './awsEnv'
import { queueAttributes } from './queueOptions'

describe('the attributes of a test queue', () => {
    test('are none for a declaration that sets no option', () => {
        expect(queueAttributes(undefined)).toBeUndefined()
        expect(queueAttributes({})).toBeUndefined()
    })

    test('are FifoQueue for a FIFO declaration', () => {
        expect(queueAttributes({ fifoQueue: true })).toEqual({ FifoQueue: 'true' })
    })

    test('carry content based deduplication as the SQS attribute, and false is a value', () => {
        expect(queueAttributes({ contentBasedDeduplication: true })).toEqual({ ContentBasedDeduplication: 'true' })
        expect(queueAttributes({ contentBasedDeduplication: false })).toEqual({ ContentBasedDeduplication: 'false' })
    })

    test('carry the deduplication scope as the SQS attribute', () => {
        expect(queueAttributes({ deduplicationScope: 'messageGroup' })).toEqual({ DeduplicationScope: 'messageGroup' })
    })

    test('carry visibilityTimeoutSeconds as VisibilityTimeout, in seconds as a string', () => {
        expect(queueAttributes({ visibilityTimeoutSeconds: 960 })).toEqual({ VisibilityTimeout: '960' })
    })

    test('carry all the options of a deployed FIFO queue together', () => {
        expect(
            queueAttributes({
                fifoQueue: true,
                contentBasedDeduplication: false,
                deduplicationScope: 'messageGroup',
                visibilityTimeoutSeconds: 960,
            }),
        ).toEqual({
            FifoQueue: 'true',
            ContentBasedDeduplication: 'false',
            DeduplicationScope: 'messageGroup',
            VisibilityTimeout: '960',
        })
    })

    test('refuse a Pulumi output, which has no value when the setup creates the queue', () => {
        expect(() => queueAttributes({ visibilityTimeoutSeconds: pulumi.output(960) })).toThrow(
            /visibilityTimeoutSeconds must be a plain value/,
        )
    })
})

describe('the setup of a queue', () => {
    let store: ReturnType<typeof Bun.serve>
    let bodies: { QueueName?: string; Attributes?: Record<string, string> }[]
    let region: string | undefined

    beforeEach(() => {
        region = process.env.AWS_REGION
        bodies = []
        store = Bun.serve({
            port: 0,
            fetch: async (request) => {
                bodies.push(await request.json())
                return new Response(JSON.stringify({ QueueUrl: 'http://127.0.0.1/000000000000/q' }), {
                    headers: { 'content-type': 'application/x-amz-json-1.0' },
                })
            },
        })
    })
    afterEach(() => {
        void store.stop(true)
        if (region === undefined) delete process.env.AWS_REGION
        else process.env.AWS_REGION = region
    })

    const create = (options?: object) =>
        ConfigureAwsEnvironment({
            options: {
                queues: { jobs: { name: 'jobs', envKeyName: 'JOBS_QUEUE_URL', options } },
                aws: {
                    sqs: {
                        endpoint: `http://127.0.0.1:${store.port}`,
                        region: 'us-east-1',
                        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
                    },
                },
            },
        })

    test('sends the options of the declaration to CreateQueue', async () => {
        await create({
            fifoQueue: true,
            contentBasedDeduplication: false,
            deduplicationScope: 'messageGroup',
            visibilityTimeoutSeconds: 960,
        })

        expect(bodies).toEqual([
            {
                QueueName: 'jobs.fifo',
                Attributes: {
                    FifoQueue: 'true',
                    ContentBasedDeduplication: 'false',
                    DeduplicationScope: 'messageGroup',
                    VisibilityTimeout: '960',
                },
            },
        ])
    })

    test('sends no attributes for a declaration that sets none', async () => {
        await create()

        expect(bodies).toEqual([{ QueueName: 'jobs' }])
    })
})
