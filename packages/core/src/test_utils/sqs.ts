import { QueueDoesNotExist, SQS, type SQSClientConfig } from '@aws-sdk/client-sqs'

/**
 * The SDK sends a request to the host of a queue URL when that host differs from the endpoint of the client, and it
 * signs the request with the credentials of the client. A store can answer queue URLs on another host than its
 * endpoint: an emulator answers the host of the AWS endpoint, and the request of a test then goes there.
 * On AWS the host of a queue URL is the endpoint, so the option changes nothing there. A value of the consumer wins.
 */
export const sqsClient = (config: SQSClientConfig | undefined) => new SQS({ useQueueUrlAsEndpoint: false, ...config })

/** The code that an SQS store answers for a queue that does not exist. The SDK maps it to the class QueueDoesNotExist. */
const MISSING_QUEUE_CODE = 'AWS.SimpleQueueService.NonExistentQueue'

export const isMissingQueue = (error: unknown): boolean =>
    error instanceof QueueDoesNotExist ||
    (error instanceof Error && error.name === 'QueueDoesNotExist') ||
    (typeof error === 'object' && error !== null && 'Code' in error && error.Code === MISSING_QUEUE_CODE)

/** For `.catch`: a queue that is not there is nothing to delete. Any other error reaches the caller. */
export const ifMissingQueue = (error: unknown): undefined => {
    if (isMissingQueue(error)) return undefined
    throw error
}
