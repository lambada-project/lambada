import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { mergeOptions } from '../api/createEndpoint'
import { createMessaging } from '.'
import { subscribeToTopic } from './createSubscription'

const created: pulumi.runtime.MockResourceArgs[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

describe('merging lambda options', () => {
    test("takes the lambda's value, and the stack's where the lambda has none", () => {
        expect(mergeOptions({ memorySize: 1024, timeout: undefined }, { memorySize: 256, timeout: 30, runtime: 'nodejs22.x' as never }))
            .toEqual({ memorySize: 1024, timeout: 30, runtime: 'nodejs22.x' } as never)
    })

    test('carries an option it has no line for', () => {
        expect(mergeOptions({ ephemeralStorage: 1024 } as never, undefined)).toEqual({ ephemeralStorage: 1024 } as never)
    })
})

test("a subscription's own lambda options reach its function, over the caller's and the stack's", async () => {
    const environment = 'test'
    const context = {
        environment,
        messaging: createMessaging(environment, { events: { name: 'events', envKeyName: 'EVENTS' } }),
        api: { apiPath: '/api', lambdaOptions: { memorySize: 256, timeout: 30 } },
        logs: { prefix: '/lambada/pets' },
    }

    const subscription = subscribeToTopic(context as never, 'events', {
        name: 'onEvent',
        callback: { functionFolder: '.', handler: 'index.main' },
        resources: {} as never,
        lambdaOptions: { memorySize: 1024, logRetention: { days: 30 } },
    }, { memorySize: 512 })
    await settled(subscription.func.arn)

    const args = created.find(r => r.type === 'aws:lambda/function:Function' && r.name === 'onEvent-test')!.inputs
    expect(args).toMatchObject({ memorySize: 1024, timeout: 30, loggingConfig: { logGroup: '/lambada/pets/onEvent-test' } })
    expect(created.find(r => r.type === 'aws:cloudwatch/logGroup:LogGroup' && r.name === 'onEvent-test-logs')!.inputs.retentionInDays).toBe(30)
})
