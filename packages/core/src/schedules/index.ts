import * as aws from "@pulumi/aws";
import { EventRuleEvent, EventRuleEventSubscription } from "@pulumi/aws/cloudwatch";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions } from "../lambdas";
import { AsyncFailures, asyncInvocationConfig, failureDestination } from "../lambdas/asyncFailures";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { asCreator, LambadaDefinition } from "../resources/creators";
import { Digit, Numbers, Positive } from "../numbers";
import { Exclusive } from "../exclusive";
import { LambadaGrantsShape, LambadaResourceRequest, resolveEnvironment, resolveGrants } from "../resources/grants";
import { unknown } from "zod";

export type ScheduleEvent = EventRuleEvent
export type ScheduleCallback = LambdaHandler<ScheduleEvent, void>

const UNITS = ['minutes', 'hours', 'days'] as const
type Units = typeof UNITS[number]
const SINGULAR = { minutes: 'minute', hours: 'hour', days: 'day' } as const satisfies Record<Units, string>
type Every = Exclusive<{ [U in Units]: Record<U, number> }[Units]>

type Minute = Numbers<`${Digit}` | `${1 | 2 | 3 | 4 | 5}${Digit}`>
type Hour = Numbers<`${Digit}` | `1${Digit}` | `2${0 | 1 | 2 | 3}`>
type Day = Numbers<`${Positive}` | `${1 | 2}${Digit}` | `3${0 | 1}`>
type Year = Numbers<`19${7 | 8 | 9}${Digit}` | `2${0 | 1}${Digit}${Digit}`>

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
export type Month = typeof MONTHS[number]
export type Weekday = typeof WEEKDAYS[number]
/** A list's positions counted from 1, as a named field ranks its values. */
type Positions<T extends readonly unknown[]> = keyof [...T, unknown] extends infer K ? K extends `${infer I extends number}` ? Exclude<I, 0> : never : never

type Range<T, Step> = { from: T, to: T, every?: Step }
type Stepped<T, Step> = { every: Step, from?: T }
/**
 * A value, a list, or one object form: a range, a step, or a form of its own. A step is at most a cyclic
 * field's highest value, months and weekdays counted from 1; a year's, at most the largest number EventBridge takes.
 */
type Field<T, Step, Own = never> = T | readonly [T, ...T[]] | Exclusive<Range<T, Step> | Stepped<T, Step> | Own>

type Nearest = { nearestWeekdayTo: Day }
type Last = { last: Weekday }
const NTHS = [1, 2, 3, 4, 5] as const
type Nth = { nth: typeof NTHS[number], of: Weekday }

type Fields = {
    minute: Field<Minute, Exclude<Minute, 0>>
    hour: Field<Hour, Exclude<Hour, 0>>
    dayOfMonth: Field<Day, Day, Nearest> | 'last'
    month: Field<Month, Positions<typeof MONTHS>>
    dayOfWeek: Field<Weekday, Positions<typeof WEEKDAYS>, Last | Nth>
    year: Field<Year, number>
}
/** At least one of T's fields, any of the rest. */
type Some<T> = { [K in keyof T]: Pick<T, K> & Partial<T> }[keyof T]
/** One or more fields, and of the two day fields one at most: EventBridge writes the other as `?`. */
export type Cron = Exclusive<Some<Omit<Fields, 'dayOfWeek'>> | Some<Omit<Fields, 'dayOfMonth'>>>

export type Schedule = Exclusive<{ every: Every } | { cron: Cron }>

type Value = number | string
/** All a field asks of its values: whether one is among them, where it falls, and the highest, months and weekdays counted from 1. */
type Values = { has: (v: Value) => boolean, rank: (v: Value) => number, highest: number }
const span = (lowest: number, highest: number): Values => ({
    has: v => typeof v === 'number' && Number.isInteger(v) && v >= lowest && v <= highest,
    rank: v => typeof v === 'number' ? v : NaN,
    highest,
})
const named = (names: readonly string[]): Values => ({
    has: v => typeof v === 'string' && names.includes(v),
    rank: v => typeof v === 'string' && names.includes(v) ? names.indexOf(v) + 1 : NaN,
    highest: names.length,
})

/** EventBridge's largest number. A field of plain data cannot refine its literal, so it is checked when written. */
const LARGEST = 2 ** 31 - 1
/** A rate, or a year's step: a whole number up to the largest. */
const counts = span(1, LARGEST)
/** A cyclic field's range may run backwards around the cycle, and its step is at most its highest value. */
const cycle = (values: Values) => ({ values, steps: span(1, values.highest), cyclic: true })

/** Years are not a cycle: a range ascends, which a type cannot order, and a step is any count. */
const fields: { [F in keyof Fields]: { values: Values, steps: Values, cyclic: boolean } } = {
    minute: cycle(span(0, 59)),
    hour: cycle(span(0, 23)),
    dayOfMonth: cycle(span(1, 31)),
    month: cycle(named(MONTHS)),
    dayOfWeek: cycle(named(WEEKDAYS)),
    year: { values: span(1970, 2199), steps: counts, cyclic: false },
}

type Refuse = () => never

const isOne = <T>(xs: readonly T[]): xs is readonly [T] => xs.length === 1
const isList = <T>(v: Field<T, number>): v is readonly [T, ...T[]] => Array.isArray(v) && v.length > 0

const one = (field: keyof Fields, v: Value, refuse: Refuse): string =>
    fields[field].values.has(v) ? String(v) : refuse()

/** Each key of form F, and whether F requires it, read from F's own type: a shape that misses a key, adds one or misreads one is a type error. */
type Shape<F> = { [K in keyof F]-?: {} extends Pick<F, K> ? 'optional' : 'required' }
/** v is form F: it holds every key F requires, and no key F lacks. */
const isForm = <F extends object>(v: unknown, shape: Shape<F>): v is F =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
    && Object.entries(shape).every(([key, need]) => need === 'optional' || (v as Record<string, unknown>)[key] !== undefined)
    && Object.keys(v).every(key => Object.keys(shape).includes(key))

const RANGE: Shape<Range<Value, number>> = { from: 'required', to: 'required', every: 'optional' }
const STEPPED: Shape<Stepped<Value, number>> = { every: 'required', from: 'optional' }
const NEAREST: Shape<Nearest> = { nearestWeekdayTo: 'required' }
const LAST: Shape<Last> = { last: 'required' }
const NTH: Shape<Nth> = { nth: 'required', of: 'required' }

const plain = (field: keyof Fields) => (v: Field<Value, number>, refuse: Refuse): string => {
    const { values, steps, cyclic } = fields[field]
    const step = (every: number | undefined) => every === undefined ? '' : steps.has(every) ? `/${every}` : refuse()
    if (typeof v !== 'object') return one(field, v, refuse)
    if (isList(v)) return v.map(x => one(field, x, refuse)).join(',')
    if (isForm<Range<Value, number>>(v, RANGE)) return cyclic || values.rank(v.from) <= values.rank(v.to)
        ? `${one(field, v.from, refuse)}-${one(field, v.to, refuse)}${step(v.every)}`
        : refuse()
    if (isForm<Stepped<Value, number>>(v, STEPPED)) return `${v.from === undefined ? '*' : one(field, v.from, refuse)}${step(v.every)}`
    return refuse()
}

const render: { [F in keyof Fields]: (value: Fields[F], refuse: Refuse) => string } = {
    minute: plain('minute'),
    hour: plain('hour'),
    month: plain('month'),
    year: plain('year'),
    dayOfMonth: (v, refuse) =>
        v === 'last' ? 'L'
        : isForm<Nearest>(v, NEAREST) ? `${one('dayOfMonth', v.nearestWeekdayTo, refuse)}W`
        : plain('dayOfMonth')(v, refuse),
    dayOfWeek: (v, refuse) =>
        isForm<Last>(v, LAST) ? `${one('dayOfWeek', v.last, refuse)}L`
        : isForm<Nth>(v, NTH) ? (NTHS.includes(v.nth) ? `${one('dayOfWeek', v.of, refuse)}#${v.nth}` : refuse())
        : plain('dayOfWeek')(v, refuse),
}

export const scheduleExpression = (name: string, schedule: Schedule): string => {
    const kinds = Object.keys(schedule)
    if (kinds.length !== 1 || !['every', 'cron'].includes(kinds[0]))
        throw new Error(`${name} schedules by ${JSON.stringify(schedule)}; a schedule takes every or cron, one of them`)
    if (schedule.every !== undefined) {
        const every = schedule.every
        const rates = UNITS.flatMap(unit => every[unit] === undefined ? [] : [[unit, every[unit]] as const])
        if (!isOne(rates) || Object.keys(every).length !== 1)
            throw new Error(`${name} runs every ${JSON.stringify(every)}; a rate takes one of ${UNITS.join(', ')}`)
        const [[unit, value]] = rates
        if (!counts.has(value)) throw new Error(`${name} runs every ${value} ${unit}; a rate takes a whole number from 1 to ${counts.highest}`)
        return `rate(${value} ${value === 1 ? SINGULAR[unit] : unit})`
    }
    const cron = schedule.cron
    const given = Object.keys(cron), known = Object.keys(fields)
    if (given.length === 0 || !given.every(k => known.includes(k)) || (cron.dayOfMonth !== undefined && cron.dayOfWeek !== undefined))
        throw new Error(`${name} sets ${JSON.stringify(cron)}; a cron takes one or more of ${known.join(', ')}, with dayOfMonth or dayOfWeek, not both`)
    const field = <V>(f: keyof Fields, value: V | undefined, write: (value: V, refuse: Refuse) => string, unset: string) =>
        value === undefined ? unset : write(value, () => {
            throw new Error(`${name} sets ${f} to ${JSON.stringify(value)}, which a cron does not take there`)
        })
    return `cron(${[
        field('minute', cron.minute, render.minute, '*'),
        field('hour', cron.hour, render.hour, '*'),
        field('dayOfMonth', cron.dayOfMonth, render.dayOfMonth, cron.dayOfWeek === undefined ? '*' : '?'),
        field('month', cron.month, render.month, '*'),
        field('dayOfWeek', cron.dayOfWeek, render.dayOfWeek, '?'),
        field('year', cron.year, render.year, '*'),
    ].join(' ')})`
}

export type LambdaSchedule<TNames extends LambadaGrantsShape = LambadaGrantsShape> = AsyncFailures & {
    name: string
    schedule: Schedule
    callback: ScheduleCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables
    resources: LambadaResourceRequest<TNames>
    lambdaOptions?: LambdaOptions
}

export type LambadaScheduleDefinition = LambadaDefinition<LambdaSchedule<any>>

export const createSchedule = (context: LambadaResources, schedule: LambdaSchedule<any>): EventRuleEventSubscription => {
    const environment = context.environment
    const expression = scheduleExpression(schedule.name, schedule.schedule)
    const grants = resolveGrants(context, { name: schedule.name, resources: schedule.resources })
    const destination = failureDestination(context, schedule.name, schedule)
    if (destination) grants.push(destination.grant)
    const envVars = resolveEnvironment(context, {
        name: schedule.name,
        resources: schedule.resources,
        environmentVariables: schedule.environmentVariables,
    })
    const artifact = isLambdaFolder(schedule.callback) ? schedule.callback : bundleOf(context.bundles, schedule.name)

    const handler = createLambda<ScheduleEvent, void>({
        name: schedule.name,
        environment,
        definition: artifact ?? schedule.callback,
        policyStatements: schedule.policyStatements,
        environmentVariables: envVars,
        resources: grants,
        options: mergeOptions(schedule.lambdaOptions, context.api?.lambdaOptions),
        description: `${schedule.name} in ${environment} on ${expression}`,
        tags: context.globalTags,
        logs: context.logs,
    })

    asyncInvocationConfig(schedule.name, environment, (handler as aws.lambda.Function).name, schedule, destination?.arn)

    return aws.cloudwatch.onSchedule(`${schedule.name}-${environment}`, expression, handler)
}

export const createSchedules = (
    context: LambadaResources,
    definitions?: readonly LambadaScheduleDefinition[]
): EventRuleEventSubscription[] =>
    (definitions ?? []).map(definition => createSchedule(context, asCreator<LambdaSchedule<any>>(definition)(context)))
