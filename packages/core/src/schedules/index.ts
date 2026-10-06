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
type Numbers<S> = S extends `${infer N extends number}` ? N : never

type Minute = Numbers<`${Digit}` | `${1 | 2 | 3 | 4 | 5}${Digit}`>
type Hour = Numbers<`${Digit}` | `1${Digit}` | `2${0 | 1 | 2 | 3}`>
type Day = Numbers<`${Exclude<Digit, 0>}` | `${1 | 2}${Digit}` | `3${0 | 1}`>
type Year = Numbers<`19${7 | 8 | 9}${Digit}` | `2${0 | 1}${Digit}${Digit}`>
type MonthStep = Numbers<`${Exclude<Digit, 0>}` | `1${0 | 1 | 2}`>

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
export type Month = typeof MONTHS[number]
export type Weekday = typeof WEEKDAYS[number]

type Field<T, Step = never> =
    | T
    | readonly [T, ...T[]]
    | { from: T, to: T }
    | ([Step] extends [never] ? never : { every: Step, from?: T })

export type Cron = {
    minute?: Field<Minute, Exclude<Minute, 0>>
    hour?: Field<Hour, Exclude<Hour, 0>>
    month?: Field<Month, MonthStep>
    year?: Field<Year, Exclude<Minute, 0>>
} & (
    | { dayOfMonth?: Field<Day, Day> | 'last' | { nearestWeekdayTo: Day }, dayOfWeek?: never }
    | { dayOfMonth?: never, dayOfWeek: Field<Weekday> | { last: Weekday } | { nth: 1 | 2 | 3 | 4 | 5, of: Weekday } }
)

export type Schedule = { every: Every } | { cron: Cron }

type Atom = ({ kind: 'number', min: number, max: number } | { kind: 'name', names: readonly string[] }) & { maxStep: number }
const atoms: { [F in keyof Cron]-?: Atom } = {
    minute: { kind: 'number', min: 0, max: 59, maxStep: 59 },
    hour: { kind: 'number', min: 0, max: 23, maxStep: 23 },
    dayOfMonth: { kind: 'number', min: 1, max: 31, maxStep: 31 },
    month: { kind: 'name', names: MONTHS, maxStep: 12 },
    dayOfWeek: { kind: 'name', names: WEEKDAYS, maxStep: 0 },
    year: { kind: 'number', min: 1970, max: 2199, maxStep: 59 },
}

const cronField = (name: string, field: keyof Cron, value: unknown): string => {
    const refuse = (): never => { throw new Error(`${name} sets ${field} to ${JSON.stringify(value)}, which a cron does not take there`) }
    const atom = (v: unknown): string => {
        const kind = atoms[field]
        const valid = kind.kind === 'number'
            ? Number.isInteger(v) && (v as number) >= kind.min && (v as number) <= kind.max
            : kind.names.includes(v as string)
        return valid ? String(v) : refuse()
    }
    const weekday = (v: unknown) => WEEKDAYS.indexOf(v as Weekday) + 1 || refuse()

    if (Array.isArray(value)) return value.length ? value.map(atom).join(',') : refuse()
    if (typeof value !== 'object' || value === null) return field === 'dayOfMonth' && value === 'last' ? 'L' : atom(value)

    const v = value as Record<string, unknown>
    if ('from' in v && 'to' in v) {
        if (field === 'year' && (v.from as number) > (v.to as number)) refuse()
        return `${atom(v.from)}-${atom(v.to)}`
    }
    if ('every' in v && atoms[field].maxStep > 0) {
        const every = v.every as number
        if (!Number.isInteger(every) || every < 1 || every > atoms[field].maxStep) refuse()
        return `${v.from === undefined ? '*' : atom(v.from)}/${every}`
    }
    if ('nearestWeekdayTo' in v && field === 'dayOfMonth') return `${atom(v.nearestWeekdayTo)}W`
    if ('last' in v && field === 'dayOfWeek') return `${weekday(v.last)}L`
    if ('nth' in v && field === 'dayOfWeek' && [1, 2, 3, 4, 5].includes(v.nth as number)) return `${weekday(v.of)}#${v.nth}`
    return refuse()
}

export const scheduleExpression = (name: string, schedule: Schedule): string => {
    if ('every' in schedule) {
        const [unit, value] = Object.entries(schedule.every).find(([, v]) => v !== undefined) as [Units, number]
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name} runs every ${value} ${unit}; a rate takes a whole number of at least 1`)
        return `rate(${value} ${value === 1 ? unit.slice(0, -1) : unit})`
    }
    const cron = schedule.cron
    if (cron.dayOfMonth !== undefined && cron.dayOfWeek !== undefined) throw new Error(`${name} sets both dayOfMonth and dayOfWeek; EventBridge takes one`)
    const field = (f: keyof Cron, unset: string) => cron[f] === undefined ? unset : cronField(name, f, cron[f])
    const dayOfMonth = field('dayOfMonth', cron.dayOfWeek === undefined ? '*' : '?')
    return `cron(${field('minute', '*')} ${field('hour', '*')} ${dayOfMonth} ${field('month', '*')} ${field('dayOfWeek', '?')} ${field('year', '*')})`
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
