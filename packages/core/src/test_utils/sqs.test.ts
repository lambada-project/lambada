import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ConfigureAwsEnvironment, RemoveResources } from './awsEnv'
import { isMissingQueue } from './sqs'

/**
 * The SDK follows a queue URL to its host only when the client has no `endpoint` option, that is, when the endpoint
 * comes from AWS_ENDPOINT_URL or from the region. So the store here is named by AWS_ENDPOINT_URL, which names a local
 * server. Two local servers speak the SQS JSON protocol. `store` plays the store the setup talks to, and `elsewhere` plays the
 * host that the store names in a queue URL, as an emulator names the host of the AWS endpoint.
 */
const json = (body: object, init: { status?: number; headers?: Record<string, string> } = {}) =>
    new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/x-amz-json-1.0', ...init.headers },
    })

type Server = { url: string; targets: string[]; stop: () => void }

/** The SDK compares the host names of the queue URL and of the endpoint, so the second server has its own name. */
const serve = (answer: (target: string) => Response, host = '127.0.0.1'): Server => {
    const targets: string[] = []
    const server = Bun.serve({
        port: 0,
        fetch: (request) => {
            const target = (request.headers.get('x-amz-target') ?? '').replace('AmazonSQS.', '')
            targets.push(target)
            return answer(target)
        },
    })
    return { url: `http://${host}:${server.port}`, targets, stop: () => void server.stop(true) }
}

const queues = { jobs: { name: 'jobs', envKeyName: 'JOBS_QUEUE_URL' } }
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }

describe('the SQS client of the test setup', () => {
    let elsewhere: Server
    let store: Server
    let region: string | undefined
    let endpointUrl: string | undefined
    let answerGetQueueUrl: () => Response

    beforeEach(() => {
        region = process.env.AWS_REGION
        endpointUrl = process.env.AWS_ENDPOINT_URL
        elsewhere = serve(() => json({}), 'localhost')
        answerGetQueueUrl = () => json({ QueueUrl: `${elsewhere.url}/000000000000/jobs` })
        store = serve((target) => {
            if (target === 'CreateQueue') return json({ QueueUrl: `${elsewhere.url}/000000000000/jobs` })
            if (target === 'GetQueueUrl') return answerGetQueueUrl()
            return json({})
        })
        process.env.AWS_ENDPOINT_URL = store.url
    })
    afterEach(() => {
        store.stop()
        elsewhere.stop()
        if (region === undefined) delete process.env.AWS_REGION
        else process.env.AWS_REGION = region
        if (endpointUrl === undefined) delete process.env.AWS_ENDPOINT_URL
        else process.env.AWS_ENDPOINT_URL = endpointUrl
    })

    const run = async (sqs: object = {}) => {
        const config = {
            options: { queues, aws: { sqs: { region: 'us-east-1', credentials, ...sqs } } },
        }
        await ConfigureAwsEnvironment(config)
        await RemoveResources(config)
    }

    test('sends a request to its endpoint from AWS_ENDPOINT_URL, not to the host that a queue URL names', async () => {
        await run()

        expect(store.targets).toEqual(['CreateQueue', 'GetQueueUrl', 'DeleteQueue'])
        expect(elsewhere.targets).toEqual([])
    })

    test('follows the host of a queue URL when the consumer asks for it', async () => {
        await run({ useQueueUrlAsEndpoint: true })

        expect(elsewhere.targets).toEqual(['DeleteQueue'])
    })

    test('deletes nothing and fails nothing when the store has no such queue', async () => {
        answerGetQueueUrl = () =>
            json(
                { __type: 'com.amazonaws.sqs#QueueDoesNotExist', message: 'The specified queue does not exist.' },
                { status: 400, headers: { 'x-amzn-query-error': 'AWS.SimpleQueueService.NonExistentQueue;Sender' } },
            )

        await run()

        expect(store.targets).toEqual(['CreateQueue', 'GetQueueUrl'])
    })

    test('fails with the error of the store when the lookup of the queue fails for any other reason', async () => {
        answerGetQueueUrl = () =>
            json(
                {
                    __type: 'com.amazon.coral.service#UnrecognizedClientException',
                    message: 'The security token included in the request is invalid.',
                },
                { status: 403 },
            )

        await expect(run()).rejects.toThrow(/security token/)
    })
})

describe('a missing queue, as the stores answer it', () => {
    test('is the class QueueDoesNotExist of the SDK', () => {
        expect(isMissingQueue(Object.assign(new Error('x'), { name: 'QueueDoesNotExist' }))).toBe(true)
    })

    test('is the code AWS.SimpleQueueService.NonExistentQueue, which the emulator and LocalStack answer with it', () => {
        expect(isMissingQueue(Object.assign(new Error('x'), { Code: 'AWS.SimpleQueueService.NonExistentQueue' }))).toBe(
            true,
        )
    })

    test('is not an error of the credentials, a throttle, or something that is not an error', () => {
        expect(isMissingQueue(Object.assign(new Error('x'), { name: 'InvalidClientTokenId' }))).toBe(false)
        expect(isMissingQueue(Object.assign(new Error('x'), { Code: 'RequestThrottled' }))).toBe(false)
        expect(isMissingQueue('QueueDoesNotExist')).toBe(false)
        expect(isMissingQueue(undefined)).toBe(false)
    })
})
