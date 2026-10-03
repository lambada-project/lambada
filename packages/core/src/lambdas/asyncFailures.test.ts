import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createMessaging } from '../messaging'
import { createQueues } from '../queue'
import { createSchedules, LambdaSchedule } from '../schedules'

const created: pulumi.runtime.MockResourceArgs[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, url: `https://${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const environment = 'test'
const context = {
    environment,
    queues: createQueues(environment, { failed: { name: 'failed', envKeyName: 'FAILED' } }),
    messaging: createMessaging(environment, { alerts: { name: 'alerts', envKeyName: 'ALERTS' } }),
}

const schedule = (name: string, failures: Partial<LambdaSchedule>): LambdaSchedule => ({
    name,
    schedule: { every: { minutes: 5 } },
    callback: { functionFolder: '.', handler: 'index.main' },
    resources: {} as never,
    ...failures,
})

const built = async (definition: LambdaSchedule) => {
    const [subscription] = createSchedules(context as never, [definition])
    await settled(pulumi.all([subscription.eventRule.arn, subscription.target.arn, subscription.permission.id]))
    await new Promise(done => setTimeout(done, 20))
    const of = (type: string) => created.find(r => r.type === type && r.name.toLowerCase().startsWith(definition.name.toLowerCase().replace(/[A-Z]/g, m => '-' + m.toLowerCase()).slice(0, 4)))
    return {
        config: created.find(r => r.type === 'aws:lambda/functionEventInvokeConfig:FunctionEventInvokeConfig' && r.name === `${definition.name}-test`),
        policy: of('aws:iam/policy:Policy'),
    }
}

describe('an async lambda that fails', () => {
    test('sends the event to the queue named, through a grant on its role', async () => {
        const { config, policy } = await built(schedule('sweep', { onFailure: { queue: 'failed' }, retries: 0, maximumEventAge: { minutes: 30 } }))

        expect(config!.inputs).toMatchObject({
            maximumRetryAttempts: 0,
            maximumEventAgeInSeconds: 1800,
            destinationConfig: { onFailure: { destination: 'arn:failed' } },
        })
        expect(JSON.stringify(policy!.inputs.policy)).toContain('"Action":["sqs:sendmessage"],"Effect":"Allow","Resource":"arn:failed"')
    })

    test('sends the event to the topic named', async () => {
        const { config } = await built(schedule('alarm', { onFailure: { topic: 'alerts' } }))

        expect(config!.inputs.destinationConfig).toEqual({ onFailure: { destination: 'arn:alerts' } })
    })

    test('has no invoke config when nothing about its failures is set', async () => {
        const { config } = await built(schedule('plain', {}))

        expect(config).toBeUndefined()
    })

    test('keeps events between 1 minute and 6 hours', () => {
        expect(() => createSchedules(context as never, [schedule('stale', { maximumEventAge: { hours: 7 } })]))
            .toThrow('stale keeps events for 25200 seconds; Lambda keeps them between 1 minute and 6 hours')
    })
})
