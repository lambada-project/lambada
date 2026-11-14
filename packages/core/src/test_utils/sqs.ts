import { SQS, type SQSClientConfig } from '@aws-sdk/client-sqs'

/**
 * The SDK sends a request to the host of a queue URL when that host differs from the endpoint of the client, and it
 * signs the request with the credentials of the client. A store can answer queue URLs on another host than its
 * endpoint: an emulator answers the host of the AWS endpoint, and the request of a test then goes there.
 * On AWS the host of a queue URL is the endpoint, so the option changes nothing there. A value of the consumer wins.
 */
export const sqsClient = (config: SQSClientConfig | undefined) => new SQS({ useQueueUrlAsEndpoint: false, ...config })
