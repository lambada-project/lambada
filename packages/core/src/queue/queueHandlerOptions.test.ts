import { describe, expect, test } from 'bun:test'
import { eventSourceMappingArgs, LambdaQueueHandler, withMappingArgs } from './createQueueHandler'

const handler = (options: Partial<LambdaQueueHandler>): LambdaQueueHandler => ({
    name: 'onJob', queue: 'jobs', callback: { functionFolder: '.', handler: 'index.main' }, resources: {} as never, ...options,
})

describe('the event source mapping of a queue handler', () => {
    test('filters on the body by the pattern, under body', () => {
        expect(eventSourceMappingArgs(handler({ filter: { body: { type: ['order.created'] } } })))
            .toEqual({ filterCriteria: { filters: [{ pattern: '{"body":{"type":["order.created"]}}' }] } })
    })

    test('filters on an attribute by its string value', () => {
        expect(eventSourceMappingArgs(handler({ filter: { attributes: { type: ['order.created'] } } })))
            .toEqual({ filterCriteria: { filters: [{ pattern: '{"messageAttributes":{"type":{"stringValue":["order.created"]}}}' }] } })
    })

    test('refuses a numeric condition on an attribute, which Lambda never matches', () => {
        // @ts-expect-error
        handler({ filter: { attributes: { amount: [{ numeric: ['>', 100] }] } } })
    })

    test('reports batch item failures, and caps concurrency', () => {
        expect(eventSourceMappingArgs(handler({ reportBatchItemFailures: true, maximumConcurrency: 5 })))
            .toEqual({ functionResponseTypes: ['ReportBatchItemFailures'], scalingConfig: { maximumConcurrency: 5 } })
    })

    test('is untouched without any of them', () => {
        expect(eventSourceMappingArgs(handler({}))).toEqual({})
    })
})

describe('the transform', () => {
    const transform = withMappingArgs({ functionResponseTypes: ['ReportBatchItemFailures'] })
    const opts = { parent: undefined } as never

    test('adds the arguments to the event source mapping', async () => {
        expect(await transform({ type: 'aws:lambda/eventSourceMapping:EventSourceMapping', name: 'm', props: { batchSize: 10 }, opts, custom: true }))
            .toEqual({ props: { batchSize: 10, functionResponseTypes: ['ReportBatchItemFailures'] }, opts })
    })

    test('leaves every other resource of the subscription alone', async () => {
        expect(await transform({ type: 'aws:lambda/function:Function', name: 'f', props: {}, opts, custom: true })).toBeUndefined()
    })
})
