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

    test('keeps events between 1 minute and 6 hours, in one unit, and fails to one destination, in its types', () => {
        const typeOnly = () => {
            // @ts-expect-error
            schedule('stale', { maximumEventAge: { minutes: 0 } })
            // @ts-expect-error
            schedule('stale', { maximumEventAge: { minutes: 361 } })
            // @ts-expect-error
            schedule('stale', { maximumEventAge: { hours: 7 } })
            // @ts-expect-error
            schedule('both', { maximumEventAge: { minutes: 5, hours: 1 } })
            // @ts-expect-error
            schedule('both', { onFailure: { queue: 'failed', topic: 'alerts' } })
            schedule('fresh', { maximumEventAge: { minutes: 360 } })
        }
        expect(typeOnly).toBeFunction()
    })

    test.each<[unknown, string]>([
        [{ hours: 7 }, 'stale keeps events for 25200 seconds; Lambda keeps them between 1 minute and 6 hours'],
        [{ minutes: 0 }, 'stale keeps events for 0 seconds'],
        [{ minutes: 361 }, 'stale keeps events for 21660 seconds'],
        [{ minutes: 1.5 }, 'stale keeps events for 90 seconds'],
        [{ minutes: 5, hours: 1 }, 'an age takes minutes or hours, one of them'],
    ])('refuses to keep events for %j, when the types are bypassed', (age, message) =>
        expect(() => createSchedules(context as never, [schedule('stale', { maximumEventAge: age as never })])).toThrow(message))

    test('refuses a queue and a topic at once, rather than drop one', () => {
        expect(() => createSchedules(context as never, [schedule('both', { onFailure: { queue: 'failed', topic: 'alerts' } as never })]))
            .toThrow('a destination takes a queue or a topic, one of them')
    })

    test.each([[{ minutes: 1 }, 60], [{ hours: 6 }, 21600], [{ minutes: 360 }, 21600]] as const)('keeps events for %j, an edge, as %i seconds', async (age, seconds) => {
        const { config } = await built(schedule(`edge${seconds}${'minutes' in age ? 'm' : 'h'}`, { maximumEventAge: age }))
        expect(config!.inputs).toMatchObject({ maximumEventAgeInSeconds: seconds })
    })
})
