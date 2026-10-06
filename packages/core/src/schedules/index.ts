import * as aws from "@pulumi/aws";
import { EventRuleEvent, EventRuleEventSubscription } from "@pulumi/aws/cloudwatch";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions } from "../lambdas";
import { AsyncFailures, asyncInvocationConfig, failureDestination } from "../lambdas/asyncFailures";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { asCreator, LambadaDefinition } from "../resources/creators";
import { LambadaGrantsShape, LambadaResourceRequest, resolveEnvironment, resolveGrants } from "../resources/grants";

export type ScheduleEvent = EventRuleEvent
export type ScheduleCallback = LambdaHandler<ScheduleEvent, void>

type Units = 'minutes' | 'hours' | 'days'
type Every = { [U in Units]: { [K in U]: number } & { [K in Exclude<Units, U>]?: never } }[Units]

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type Positive = Exclude<Digit, 0>
type Numbers<S> = S extends `${infer N extends number}` ? N : never

type Minute = Numbers<`${Digit}` | `${1 | 2 | 3 | 4 | 5}${Digit}`>
type Hour = Numbers<`${Digit}` | `1${Digit}` | `2${0 | 1 | 2 | 3}`>
type Day = Numbers<`${Positive}` | `${1 | 2}${Digit}` | `3${0 | 1}`>
type Year = Numbers<`19${7 | 8 | 9}${Digit}` | `2${0 | 1}${Digit}${Digit}`>

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
export type Month = typeof MONTHS[number]
export type Weekday = typeof WEEKDAYS[number]

/** A step is at most the field's highest value, months and weekdays counted from 1: the most EventBridge takes. */
type Field<T, Step> = T | readonly [T, ...T[]] | { from: T, to: T } | { every: Step, from?: T }

export type Cron = {
    minute?: Field<Minute, Exclude<Minute, 0>>
    hour?: Field<Hour, Exclude<Hour, 0>>
    month?: Field<Month, Numbers<`${Positive}` | `1${0 | 1 | 2}`>>
    year?: Field<Year, Numbers<`${Positive}` | `${Positive}${Digit}` | `${Positive}${Digit}${Digit}` | `1${Digit}${Digit}${Digit}` | `2${0 | 1}${Digit}${Digit}`>>
} & (
    | { dayOfMonth?: Field<Day, Day> | 'last' | { nearestWeekdayTo: Day }, dayOfWeek?: never }
    | { dayOfMonth?: never, dayOfWeek: Field<Weekday, 1 | 2 | 3 | 4 | 5 | 6 | 7> | { last: Weekday } | { nth: 1 | 2 | 3 | 4 | 5, of: Weekday } }
)

export type Schedule = { every: Every } | { cron: Cron }

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** A range may run backwards only in a field that wraps around; years do not. */
const fields: { [F in keyof Cron]-?: { values: readonly (number | string)[], wraps: boolean } } = {
    minute: { values: range(0, 59), wraps: true },
    hour: { values: range(0, 23), wraps: true },
    dayOfMonth: { values: range(1, 31), wraps: true },
    month: { values: MONTHS, wraps: true },
    dayOfWeek: { values: WEEKDAYS, wraps: true },
    year: { values: range(1970, 2199), wraps: false },
}

type Refuse = () => never
type Render = (value: unknown, refuse: Refuse) => string

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const one = (field: keyof Cron, v: unknown, refuse: Refuse): string =>
    fields[field].values.includes(v as never) ? String(v) : refuse()

const plain = (field: keyof Cron): Render => (v, refuse) => {
    const { values, wraps } = fields[field]
    const highest = typeof values[values.length - 1] === 'number' ? values[values.length - 1] as number : values.length
    if (Array.isArray(v)) return v.length ? v.map(x => one(field, x, refuse)).join(',') : refuse()
    if (!isObject(v)) return one(field, v, refuse)
    if ('to' in v) return wraps || values.indexOf(v.from as never) <= values.indexOf(v.to as never)
        ? `${one(field, v.from, refuse)}-${one(field, v.to, refuse)}`
        : refuse()
    if ('every' in v) return Number.isInteger(v.every) && (v.every as number) >= 1 && (v.every as number) <= highest
        ? `${v.from === undefined ? '*' : one(field, v.from, refuse)}/${v.every}`
        : refuse()
    return refuse()
}

const render: { [F in keyof Cron]-?: Render } = {
    minute: plain('minute'),
    hour: plain('hour'),
    month: plain('month'),
    year: plain('year'),
    dayOfMonth: (v, refuse) =>
        v === 'last' ? 'L'
        : isObject(v) && 'nearestWeekdayTo' in v ? `${one('dayOfMonth', v.nearestWeekdayTo, refuse)}W`
        : plain('dayOfMonth')(v, refuse),
    dayOfWeek: (v, refuse) =>
        isObject(v) && 'last' in v ? `${one('dayOfWeek', v.last, refuse)}L`
        : isObject(v) && 'nth' in v ? ([1, 2, 3, 4, 5].includes(v.nth as number) ? `${one('dayOfWeek', v.of, refuse)}#${v.nth}` : refuse())
        : plain('dayOfWeek')(v, refuse),
}

export const scheduleExpression = (name: string, schedule: Schedule): string => {
    if ('every' in schedule) {
        const [unit, value] = Object.entries(schedule.every).find(([, v]) => v !== undefined) as [Units, number]
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name} runs every ${value} ${unit}; a rate takes a whole number of at least 1`)
        return `rate(${value} ${value === 1 ? unit.slice(0, -1) : unit})`
    }
    const cron = schedule.cron
    if (cron.dayOfMonth !== undefined && cron.dayOfWeek !== undefined) throw new Error(`${name} sets both dayOfMonth and dayOfWeek; EventBridge takes one`)
    const field = (f: keyof Cron, unset: string) => cron[f] === undefined ? unset : render[f](cron[f], () => {
        throw new Error(`${name} sets ${f} to ${JSON.stringify(cron[f])}, which a cron does not take there`)
    })
    return `cron(${field('minute', '*')} ${field('hour', '*')} ${field('dayOfMonth', cron.dayOfWeek === undefined ? '*' : '?')} ${field('month', '*')} ${field('dayOfWeek', '?')} ${field('year', '*')})`
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
