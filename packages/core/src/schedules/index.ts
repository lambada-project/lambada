import * as aws from "@pulumi/aws";
import { EventRuleEvent, EventRuleEventSubscription } from "@pulumi/aws/cloudwatch";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions } from "../lambdas";
import { AsyncFailures, asyncInvocationConfig, failureDestination } from "../lambdas/asyncFailures";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { asCreator, LambadaDefinition } from "../resources/creators";
import { Digit, Numbers, Positions, Positive } from "../types/numbers";
import { Exclusive, hasShape, isOneOf, isSomeOf, OneOf, Shape, SomeOf } from "../types/forms";
import { isArray, isOne, NonEmpty, OneOrMany } from "../types/lists";
import { LambadaGrantsShape, LambadaResourceRequest, resolveEnvironment, resolveGrants } from "../resources/grants";

export type ScheduleEvent = EventRuleEvent
export type ScheduleCallback = LambdaHandler<ScheduleEvent, void>

const UNITS = ['minutes', 'hours', 'days'] as const
type Units = typeof UNITS[number]
const SINGULAR = { minutes: 'minute', hours: 'hour', days: 'day' } as const satisfies Record<Units, string>
type Every = OneOf<Record<Units, number>>

type Minute = Numbers<`${Digit}` | `${1 | 2 | 3 | 4 | 5}${Digit}`>
type Hour = Numbers<`${Digit}` | `1${Digit}` | `2${0 | 1 | 2 | 3}`>
type Day = Numbers<`${Positive}` | `${1 | 2}${Digit}` | `3${0 | 1}`>
type Year = Numbers<`19${7 | 8 | 9}${Digit}` | `2${0 | 1}${Digit}${Digit}`>

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
export type Month = typeof MONTHS[number]
export type Weekday = typeof WEEKDAYS[number]

type Range<T, Step> = { from: T, to: T, every?: Step }
type Stepped<T, Step> = { every: Step, from?: T }
/** A step is at most a cyclic field's highest value, months and weekdays counted from 1; a year's, at most EventBridge's largest number. */
type Field<T, Step, Own = never> = OneOrMany<T> | Exclusive<Range<T, Step> | Stepped<T, Step> | Own>

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
/** Of the two day fields one at most: EventBridge writes the other as `?`. */
export type Cron = Exclusive<SomeOf<Omit<Fields, 'dayOfWeek'>> | SomeOf<Omit<Fields, 'dayOfMonth'>>>

type Kinds = { every: Every, cron: Cron }
export type Schedule = OneOf<Kinds>

type Value = number | string
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

/** EventBridge's largest number, which a type cannot refine a literal to, so it is checked when written. */
const LARGEST = 2 ** 31 - 1
const counts = span(1, LARGEST)
type Refuse = () => never

const isList = <T>(v: Field<T, number>): v is NonEmpty<T> => isArray(v) && v.length > 0

type Writer = { value: (v: Value) => string, step: (every: number | undefined) => string, ascends: (from: Value, to: Value) => boolean, refuse: Refuse }
const writerOf = ({ values, steps, cyclic }: Pick<Codec<keyof Fields>, 'values' | 'steps' | 'cyclic'>, refuse: Refuse): Writer => ({
    value: v => values.has(v) ? String(v) : refuse(),
    step: every => every === undefined ? '' : steps.has(every) ? `/${every}` : refuse(),
    ascends: (from, to) => cyclic || values.rank(from) <= values.rank(to),
    refuse,
})

const RANGE: Shape<Range<Value, number>> = { from: 'required', to: 'required', every: 'optional' }
const STEPPED: Shape<Stepped<Value, number>> = { every: 'required', from: 'optional' }
const NEAREST: Shape<Nearest> = { nearestWeekdayTo: 'required' }
const LAST: Shape<Last> = { last: 'required' }
const NTH: Shape<Nth> = { nth: 'required', of: 'required' }

const plain = (v: Field<Value, number>, w: Writer): string => {
    if (typeof v === 'number' || typeof v === 'string') return w.value(v)
    if (isList(v)) return v.map(w.value).join(',')
    if (hasShape(v, RANGE)) return w.ascends(v.from, v.to) ? `${w.value(v.from)}-${w.value(v.to)}${w.step(v.every)}` : w.refuse()
    if (hasShape(v, STEPPED)) return `${v.from === undefined ? '*' : w.value(v.from)}${w.step(v.every)}`
    v satisfies never
    return w.refuse()
}

type Codec<F extends keyof Fields> = { values: Values, steps: Values, cyclic: boolean, write: (value: Fields[F], w: Writer) => string }
/** A cyclic field's range may run backwards around the cycle. */
const cycle = (values: Values) => ({ values, steps: span(1, values.highest), cyclic: true })

/** In EventBridge's order. Years are not a cycle: a range ascends, which a type cannot order, and a step is any count. */
const fields: { [F in keyof Fields]: Codec<F> } = {
    minute: { ...cycle(span(0, 59)), write: plain },
    hour: { ...cycle(span(0, 23)), write: plain },
    dayOfMonth: { ...cycle(span(1, 31)), write: (v, w) => v === 'last' ? 'L' : hasShape(v, NEAREST) ? `${w.value(v.nearestWeekdayTo)}W` : plain(v, w) },
    month: { ...cycle(named(MONTHS)), write: plain },
    dayOfWeek: {
        ...cycle(named(WEEKDAYS)),
        write: (v, w) => hasShape(v, LAST) ? `${w.value(v.last)}L` : hasShape(v, NTH) ? (NTHS.includes(v.nth) ? `${w.value(v.of)}#${v.nth}` : w.refuse()) : plain(v, w),
    },
    year: { values: span(1970, 2199), steps: counts, cyclic: false, write: plain },
}

export const scheduleExpression = (name: string, schedule: Schedule): string => {
    if (!isOneOf<Kinds>(schedule, { every: true, cron: true }))
        throw new Error(`${name} schedules by ${JSON.stringify(schedule)}; a schedule takes every or cron, one of them`)
    if (schedule.every !== undefined) {
        const every = schedule.every
        const rates = UNITS.flatMap(unit => every[unit] === undefined ? [] : [[unit, every[unit]] as const])
        if (!isOneOf<Record<Units, number>>(every, SINGULAR) || !isOne(rates))
            throw new Error(`${name} runs every ${JSON.stringify(every)}; a rate takes one of ${UNITS.join(', ')}`)
        const [[unit, value]] = rates
        if (!counts.has(value)) throw new Error(`${name} runs every ${value} ${unit}; a rate takes a whole number from 1 to ${counts.highest}`)
        return `rate(${value} ${value === 1 ? SINGULAR[unit] : unit})`
    }
    const cron = schedule.cron
    if (!isSomeOf<Fields>(cron, fields) || (cron.dayOfMonth !== undefined && cron.dayOfWeek !== undefined))
        throw new Error(`${name} sets ${JSON.stringify(cron)}; a cron takes one or more of ${Object.keys(fields).join(', ')}, with dayOfMonth or dayOfWeek, not both`)
    /** TypeScript cannot pair a field's codec with a value read by a generic name (TS2590), so each field passes its own value. */
    const field = <K extends keyof Fields>(f: K, value: Fields[K] | undefined): string =>
        value === undefined ? '*' : fields[f].write(value, writerOf(fields[f], () => {
            throw new Error(`${name} sets ${f} to ${JSON.stringify(value)}, which a cron does not take there`)
        }))
    /** EventBridge writes `?` for the day field not chosen; a cron that chooses neither runs every day of the month. */
    const [dayOfMonth, dayOfWeek] = cron.dayOfWeek === undefined ? [field('dayOfMonth', cron.dayOfMonth), '?'] : ['?', field('dayOfWeek', cron.dayOfWeek)]
    return `cron(${[field('minute', cron.minute), field('hour', cron.hour), dayOfMonth, field('month', cron.month), dayOfWeek, field('year', cron.year)].join(' ')})`
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
