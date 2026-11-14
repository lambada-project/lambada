import type { QueueAttributeName } from '@aws-sdk/client-sqs'
import type { QueueArgs } from '@pulumi/aws/sqs'

/**
 * A deployed queue takes its options as Pulumi `QueueArgs`, and the Pulumi provider maps each one to an SQS attribute.
 * The setup creates a queue through the SQS API, so it needs the same mapping, in plain values. The table is typed
 * against both sides: a key that `QueueArgs` does not have, and a name that SQS does not have, fail the type check.
 * The options that are not in the table do not reach a test queue.
 */
const ATTRIBUTES = [
    ['contentBasedDeduplication', 'ContentBasedDeduplication'],
    ['deduplicationScope', 'DeduplicationScope'],
    ['visibilityTimeoutSeconds', 'VisibilityTimeout'],
] as const satisfies readonly (readonly [keyof QueueArgs, QueueAttributeName])[]

/** A test queue is created at once, so an option that is a Pulumi output, which has no value yet, cannot reach it. */
const plain = (option: string, value: unknown): string => {
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return String(value)
    throw new Error(`The queue option ${option} must be a plain value in a test setup, not a Pulumi output`)
}

/** The attributes of CreateQueue for a declaration. Absent when the declaration sets none. */
export const queueAttributes = (options: QueueArgs | undefined): Record<string, string> | undefined => {
    const attributes: Record<string, string> = {}
    if (options?.fifoQueue) attributes.FifoQueue = 'true'
    for (const [option, attribute] of ATTRIBUTES) {
        const value = options?.[option]
        if (value !== undefined) attributes[attribute] = plain(option, value)
    }
    return Object.keys(attributes).length > 0 ? attributes : undefined
}
