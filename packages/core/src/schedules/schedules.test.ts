import verdicts from './eventBridgeVerdicts.json'
import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables } from '../database'
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

    test('logs to a log group of its own when the stack declares logs, with no api in the stack', async () => {
        const [subscription] = createSchedules({ ...context, api: undefined, logs: { prefix: '/lambada/pets' } } as never, [schedule('logQuotes')])
        await registered(subscription)

        expect(ofType('aws:lambda/function:Function', 'logQuotes-test').inputs.loggingConfig).toEqual({ logFormat: 'Text', logGroup: '/lambada/pets/logQuotes-test' })
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
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 9, dayOfWeek: { from: 'MON', to: 'FRI' } } })).toBe('cron(0 9 ? * MON-FRI *)')
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfMonth: 'last' } })).toBe('cron(0 0 L * ? *)')
    })

    test('writes lists, ranges and steps, with months and weekdays by name', () => {
        expect(scheduleExpression('s', { cron: { minute: [0, 30], hour: { every: 2 }, month: ['JAN', 'JUL'] } })).toBe('cron(0,30 */2 * JAN,JUL ? *)')
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfWeek: { every: 2, from: 'MON' } } })).toBe('cron(0 0 ? * MON/2 *)')
        expect(scheduleExpression('s', { cron: { minute: { every: 15, from: 5 }, month: { from: 'JAN', to: 'JUN' }, year: [2026, 2027] } }))
            .toBe('cron(5/15 * * JAN-JUN ? 2026,2027)')
    })

    test('writes the last, the nth and the nearest weekday', () => {
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfWeek: { nth: 3, of: 'FRI' } } })).toBe('cron(0 0 ? * FRI#3 *)')
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfWeek: { last: 'FRI' } } })).toBe('cron(0 0 ? * FRIL *)')
        expect(scheduleExpression('s', { cron: { minute: 0, hour: 0, dayOfMonth: { nearestWeekdayTo: 15 } } })).toBe('cron(0 0 15W * ? *)')
    })

    test('takes only what each field can hold', () => {
        const typeOnly = () => {
            // @ts-expect-error
            scheduleExpression('s', { cron: { minute: 60 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { hour: 24 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfMonth: 0 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { month: 1 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfWeek: 'MONDAY' } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfMonth: '?' } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfWeek: { every: 8 } } })
        }
        expect(typeOnly).toBeFunction()
    })

    test('refuses what a field cannot hold when the types are bypassed', () => {
        expect(() => scheduleExpression('report', { cron: { dayOfMonth: '?' } } as never)).toThrow('report sets dayOfMonth to "?"')
        expect(() => scheduleExpression('report', { cron: { minute: 60 } } as never)).toThrow('report sets minute to 60')
        expect(() => scheduleExpression('report', { cron: { minute: '0 12' } } as never)).toThrow('report sets minute to "0 12"')
        expect(() => scheduleExpression('report', { cron: { hour: [] } } as never)).toThrow('report sets hour to []')
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

describe('a cron, against what EventBridge said of it', () => {
    const written = (cron: unknown) => { try { return scheduleExpression('s', { cron } as never) } catch { return undefined } }

    test('writes nothing EventBridge rejects', () => {
        expect(verdicts.filter(v => v.eventBridge === 'rejects' && written(v.cron) !== undefined)).toEqual([])
    })

    test('writes what EventBridge accepts as EventBridge accepted it, refusing only what it does not document', () => {
        const accepted = verdicts.filter(v => v.eventBridge === 'accepts')
        expect(accepted.filter(v => written(v.cron) !== undefined && written(v.cron) !== v.expression)).toEqual([])
        expect(accepted.filter(v => written(v.cron) === undefined).map(v => v.expression)).toEqual([
            'cron(1.5 * * * ? *)',
            'cron(*/0 * * * ? *)',
            'cron(* * * jan ? *)',
            'cron(* * * 1 ? *)',
            'cron(* * * * ? 1969)',
            'cron(* * * * ? 2200)',
        ])
    })
})
