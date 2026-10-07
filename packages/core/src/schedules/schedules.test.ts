import verdicts from './eventBridgeVerdicts.json'
import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createDynamoDbTables } from '../database'
import { createSchedules, Cron, LambdaSchedule, Schedule, scheduleExpression } from '.'

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
    test.each<[string, Schedule, string]>([
        ['every n units', { every: { minutes: 10 } }, 'rate(10 minutes)'],
        ['a unit in the singular for 1', { every: { hours: 1 } }, 'rate(1 hour)'],
        ['every n days', { every: { days: 2 } }, 'rate(2 days)'],
        ['a cron, any field it leaves out', { cron: { minute: 0, hour: 12 } }, 'cron(0 12 * * ? *)'],
        ['? in the day of the month, given one of the week', { cron: { minute: 0, hour: 9, dayOfWeek: { from: 'MON', to: 'FRI' } } }, 'cron(0 9 ? * MON-FRI *)'],
        ['? in the day of the week, given one of the month', { cron: { minute: 0, hour: 0, dayOfMonth: 'last' } }, 'cron(0 0 L * ? *)'],
        ['lists and a step, months by name', { cron: { minute: [0, 30], hour: { every: 2 }, month: ['JAN', 'JUL'] } }, 'cron(0,30 */2 * JAN,JUL ? *)'],
        ['a step from a weekday by name', { cron: { minute: 0, hour: 0, dayOfWeek: { every: 2, from: 'MON' } } }, 'cron(0 0 ? * MON/2 *)'],
        ['a step from a value, a range of months, a list of years', { cron: { minute: { every: 15, from: 5 }, month: { from: 'JAN', to: 'JUN' }, year: [2026, 2027] } }, 'cron(5/15 * * JAN-JUN ? 2026,2027)'],
        ['a step through a range', { cron: { minute: { from: 5, to: 10, every: 2 } } }, 'cron(5-10/2 * * * ? *)'],
        ['the nth weekday', { cron: { minute: 0, hour: 0, dayOfWeek: { nth: 3, of: 'FRI' } } }, 'cron(0 0 ? * FRI#3 *)'],
        ['the last weekday', { cron: { minute: 0, hour: 0, dayOfWeek: { last: 'FRI' } } }, 'cron(0 0 ? * FRIL *)'],
        ['the weekday nearest a day', { cron: { minute: 0, hour: 0, dayOfMonth: { nearestWeekdayTo: 15 } } }, 'cron(0 0 15W * ? *)'],
    ])('writes %s', (_, schedule, expression) => expect(scheduleExpression('s', schedule)).toBe(expression))

    test.each<[string, unknown, string]>([
        ['a minute in two forms', { cron: { minute: { from: 5, every: 2, last: 'FRI' } } }, 'report sets minute to'],
        ['a day of the week in two forms', { cron: { dayOfWeek: { last: 'FRI', nth: 2, of: 'MON' } } }, 'report sets dayOfWeek to'],
        ['a day of the month in two forms', { cron: { dayOfMonth: { nearestWeekdayTo: 15, every: 2 } } }, 'report sets dayOfMonth to'],
        ['? as a value', { cron: { dayOfMonth: '?' } }, 'report sets dayOfMonth to "?"'],
        ['a minute past 59', { cron: { minute: 60 } }, 'report sets minute to 60'],
        ['an expression for a field', { cron: { minute: '0 12' } }, 'report sets minute to "0 12"'],
        ['an empty list', { cron: { hour: [] } }, 'report sets hour to []'],
        ['a rate of 0', { every: { minutes: 0 } }, 'report runs every 0 minutes'],
        ['a rate that is not whole', { every: { hours: 1.5 } }, 'a rate takes a whole number from 1 to 2147483647'],
        ['a rate of no unit', { every: {} }, 'report runs every {}; a rate takes one of minutes, hours, days'],
        ['a rate of an unknown unit', { every: { weeks: 2 } }, 'report runs every {"weeks":2}'],
        ['a rate of two units', { every: { hours: 1, minutes: 5 } }, 'report runs every {"hours":1,"minutes":5}'],
        ['a rate of a unit and an unknown one', { every: { minutes: 5, weeks: 1 } }, 'report runs every {"minutes":5,"weeks":1}'],
        ['both day fields', { cron: { dayOfMonth: 1, dayOfWeek: 'MON' } }, 'report sets {"dayOfMonth":1,"dayOfWeek":"MON"}; a cron takes one or more of minute, hour, dayOfMonth, month, dayOfWeek, year, with dayOfMonth or dayOfWeek, not both'],
        ['an empty cron', { cron: {} }, 'report sets {}'],
        ['a misspelled field', { cron: { minutes: 5 } }, 'report sets {"minutes":5}'],
        ['a field a cron lacks', { cron: { minute: 0, seconds: 30 } }, 'report sets {"minute":0,"seconds":30}'],
        ['every and cron at once', { every: { minutes: 5 }, cron: { minute: 0 } }, 'report schedules by {"every":{"minutes":5},"cron":{"minute":0}}; a schedule takes every or cron, one of them'],
        ['a kind it does not know', { at: '2026-01-01' }, 'report schedules by {"at":"2026-01-01"}'],
    ])('refuses %s, when the types are bypassed', (_, schedule, message) => expect(() => scheduleExpression('report', schedule as never)).toThrow(message))

    const within: Cron[] = [
        { minute: 0 }, { minute: 59 }, { hour: 23 }, { dayOfMonth: 1 }, { dayOfMonth: 31 }, { year: 1970 }, { year: 2199 },
        { minute: { every: 59 } }, { hour: { every: 23 } }, { dayOfMonth: { every: 31 } }, { month: { every: 12 } },
        { dayOfWeek: { every: 7 } }, { year: { every: 2199 } }, { year: { every: 2200 } },
    ]
    const beyond: unknown[] = [
        // @ts-expect-error
        { minute: -1 } satisfies Cron,
        // @ts-expect-error
        { minute: 60 } satisfies Cron,
        // @ts-expect-error
        { hour: 24 } satisfies Cron,
        // @ts-expect-error
        { dayOfMonth: 0 } satisfies Cron,
        // @ts-expect-error
        { dayOfMonth: 32 } satisfies Cron,
        // @ts-expect-error
        { year: 1969 } satisfies Cron,
        // @ts-expect-error
        { year: 2200 } satisfies Cron,
        // @ts-expect-error
        { minute: { every: 60 } } satisfies Cron,
        // @ts-expect-error
        { hour: { every: 24 } } satisfies Cron,
        // @ts-expect-error
        { dayOfMonth: { every: 32 } } satisfies Cron,
        // @ts-expect-error
        { month: { every: 13 } } satisfies Cron,
        // @ts-expect-error
        { dayOfWeek: { every: 8 } } satisfies Cron,
    ]
    test.each(within)('writes %j, an edge its type holds', cron => expect(() => scheduleExpression('s', { cron })).not.toThrow())
    test.each(beyond)('refuses %j, past an edge its type refuses', cron => expect(() => scheduleExpression('s', { cron } as never)).toThrow('which a cron does not take there'))

    test('takes only what each field can hold, one form of a field at a time', () => {
        const typeOnly = () => {
            // @ts-expect-error
            scheduleExpression('s', { cron: { month: 1 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfWeek: 'MONDAY' } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfMonth: '?' } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfWeek: { nth: 6, of: 'FRI' } } });
            // @ts-expect-error
            ({ minute: 0, dayOfWeek: { last: 'FRI', nth: 2, of: 'MON' } }) satisfies Cron;
            // @ts-expect-error
            ({ dayOfMonth: { nearestWeekdayTo: 15, every: 2 } }) satisfies Cron
        }
        expect(typeOnly).toBeFunction()
    })

    test('takes one unit, and a cron of one or more fields with a day of the month or of the week', () => {
        const typeOnly = () => {
            // @ts-expect-error
            scheduleExpression('s', { every: { minutes: 1, hours: 1 } })
            // @ts-expect-error
            scheduleExpression('s', { cron: { dayOfMonth: 1, dayOfWeek: 'MON' } });
            // @ts-expect-error
            ({}) satisfies Cron;
            // @ts-expect-error
            ({ minutes: 5 }) satisfies Cron;
            // @ts-expect-error
            ({ every: { minutes: 5 }, cron: { minute: 0 } }) satisfies Schedule;
            ({ minute: 0, hour: 9, month: 'JAN', year: 2026, dayOfMonth: 1 }) satisfies Cron;
            ({ minute: 0, hour: 9, month: 'JAN', year: 2026, dayOfWeek: 'MON' }) satisfies Cron
        }
        expect(typeOnly).toBeFunction()
    })
})

describe('a schedule, against what EventBridge said of it', () => {
    const written = (schedule: unknown) => { try { return scheduleExpression('s', schedule as never) } catch { return undefined } }

    test('writes nothing EventBridge rejects', () => {
        expect(verdicts.filter(v => v.eventBridge === 'rejects' && written(v.schedule) !== undefined)).toEqual([])
    })

    test('writes what EventBridge accepts as EventBridge accepted it, refusing only what it does not document', () => {
        const accepted = verdicts.filter(v => v.eventBridge === 'accepts')
        expect(accepted.filter(v => written(v.schedule) !== undefined && written(v.schedule) !== v.expression)).toEqual([])
        expect(accepted.filter(v => written(v.schedule) === undefined).map(v => v.expression)).toEqual([
            'cron(1.5 * * * ? *)',
            'cron(*/0 * * * ? *)',
            'cron(* * * jan ? *)',
            'cron(* * * 1 ? *)',
            'cron(* * * * ? 1969)',
            'cron(* * * * ? 2200)',
        ])
    })
})
