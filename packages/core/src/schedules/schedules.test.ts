import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables } from '../database'
import { createLogGroups } from '../logs'
import { createSchedules, LambdaSchedule, scheduleExpression } from '.'

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

const environment = 'test'
const context = {
    environment,
    databases: createDynamoDbTables(environment, { quotes: { name: 'quotes', primaryKey: 'id', envKeyName: 'QUOTES' } }),
}

const schedule = (name: string, overrides: Partial<LambdaSchedule> = {}): LambdaSchedule => ({
    name,
    schedule: { every: { minutes: 10 } },
    callback: { functionFolder: '.', handler: 'index.main' },
    resources: { table: { quotes: ['dynamodb:PutItem'] } } as never,
    ...overrides,
})

const registered = (subscription: ReturnType<typeof createSchedules>[number]) =>
    settled(pulumi.all([subscription.eventRule.arn, subscription.target.arn, subscription.permission.id]))

const ofType = (type: string, name: string) => created.find(r => r.type === type && r.name.startsWith(name))!

describe('a schedule', () => {
    test('runs its lambda on the schedule expression', async () => {
        const [subscription] = createSchedules(context as never, [schedule('broadcastQuotes', { schedule: { cron: { minute: 0, hour: 12 } } })])
        await registered(subscription)

        expect(ofType('aws:cloudwatch/eventRule:EventRule', 'broadcastQuotes-test').inputs.scheduleExpression).toBe('cron(0 12 * * ? *)')
        expect(ofType('aws:cloudwatch/eventTarget:EventTarget', 'broadcastQuotes-test').inputs.arn).toBe('arn:broadcastQuotes-test')
    })

    test('grants its lambda what it declares, and publishes the env vars of those grants', async () => {
        const [subscription] = createSchedules(context as never, [schedule('expireQuotes')])
        await registered(subscription)

        expect(await settled(ofType('aws:lambda/function:Function', 'expireQuotes-test').inputs.environment))
            .toMatchObject({ variables: { QUOTES: 'quotes-test' } })
    })

    test("is granted the stack's dynamodb key, as every other handler is", async () => {
        const keyed = { ...context, kmsKeys: { dynamodb: { awsKmsKey: { arn: 'arn:key/dynamodb' } } } }
        const [subscription] = createSchedules(keyed as never, [schedule('decryptQuotes')])
        await registered(subscription)

        expect(JSON.stringify(ofType('aws:iam/policy:Policy', 'decrypt-quotes-test').inputs.policy)).toContain('"Resource":"arn:key/dynamodb"')
    })

    test('logs to the log group its lambda options name', async () => {
        const logged = { ...context, logGroups: createLogGroups(environment, { jobs: { name: 'jobs' } }) }
        const [subscription] = createSchedules(logged as never, [schedule('logQuotes', { lambdaOptions: { logGroup: 'jobs' } })])
        await registered(subscription)

        expect(ofType('aws:lambda/function:Function', 'logQuotes-test').inputs.loggingConfig).toEqual({ logFormat: 'Text', logGroup: '/lambada/jobs-test' })
    })

    test('may be written as a creator of the context', async () => {
        const [subscription] = createSchedules(context as never, [() => schedule('purgeQuotes')])
        await registered(subscription)

        expect(ofType('aws:cloudwatch/eventRule:EventRule', 'purgeQuotes-test')).toBeDefined()
    })

    test('takes no expression string', () => {
        // @ts-expect-error
        schedule('typo', { schedule: 'rate(10 minutes)' })
    })
})

describe('a schedule expression', () => {
    test('runs every n units, singular for 1', () => {
        expect(scheduleExpression('s', { every: { minutes: 10 } })).toBe('rate(10 minutes)')
        expect(scheduleExpression('s', { every: { hours: 1 } })).toBe('rate(1 hour)')
        expect(scheduleExpression('s', { every: { days: 2 } })).toBe('rate(2 days)')
    })

    test('runs on a cron, every field it leaves out being any', () => {
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 12 } })).toBe('cron(0 12 * * ? *)')
    })

    test('puts ? in the day field it does not use', () => {
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 9, dayOfWeek: 'MON-FRI' } })).toBe('cron(0 9 ? * MON-FRI *)')
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfMonth: 'L' } })).toBe('cron(0 0 L * ? *)')
    })

    test('refuses a rate that is not a whole number of at least 1', () => {
        expect(() => scheduleExpression('purge', { every: { minutes: 0 } })).toThrow('purge runs every 0 minutes')
        expect(() => scheduleExpression('purge', { every: { hours: 1.5 } })).toThrow('a rate takes a whole number of at least 1')
    })

    test('takes one unit, and one day field', () => {
        const typeOnly = () => {
            // @ts-expect-error
            scheduleExpression('s', { every: { minutes: 1, hours: 1 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfMonth: 1, dayOfWeek: 'MON' } })
        }
        expect(typeOnly).toBeFunction()
    })

    test('refuses both day fields when the types are bypassed', () => {
        expect(() => scheduleExpression('report', { cron: { dayOfMonth: 1, dayOfWeek: 'MON' } } as never))
            .toThrow('report sets both dayOfMonth and dayOfWeek')
    })
})
