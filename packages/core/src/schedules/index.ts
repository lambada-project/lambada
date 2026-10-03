import * as aws from "@pulumi/aws";
import { EventRuleEvent, EventRuleEventSubscription } from "@pulumi/aws/cloudwatch";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions } from "../lambdas";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { asCreator, LambadaDefinition } from "../resources/creators";
import { LambadaGrantsShape, LambadaResourceRequest, resolveEnvironment, resolveGrants } from "../resources/grants";

export type ScheduleEvent = EventRuleEvent
export type ScheduleCallback = LambdaHandler<ScheduleEvent, void>

type Units = 'minutes' | 'hours' | 'days'
type Every = { [U in Units]: { [K in U]: number } & { [K in Exclude<Units, U>]?: never } }[Units]

type CronField = number | string
type Cron = { minute?: CronField, hour?: CronField, month?: CronField, year?: CronField } & (
    | { dayOfMonth?: CronField, dayOfWeek?: never }
    | { dayOfMonth?: never, dayOfWeek: CronField }
)

export type Schedule = { every: Every } | { cron: Cron }

export const scheduleExpression = (name: string, schedule: Schedule): string => {
    if ('every' in schedule) {
        const [unit, value] = Object.entries(schedule.every).find(([, v]) => v !== undefined) as [Units, number]
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name} runs every ${value} ${unit}; a rate takes a whole number of at least 1`)
        return `rate(${value} ${value === 1 ? unit.slice(0, -1) : unit})`
    }
    const { minute = '*', hour = '*', dayOfMonth, month = '*', dayOfWeek, year = '*' } = schedule.cron
    if (dayOfMonth !== undefined && dayOfWeek !== undefined) throw new Error(`${name} sets both dayOfMonth and dayOfWeek; EventBridge takes one`)
    return `cron(${minute} ${hour} ${dayOfMonth ?? (dayOfWeek === undefined ? '*' : '?')} ${month} ${dayOfWeek ?? '?'} ${year})`
}

export type LambdaSchedule<TNames extends LambadaGrantsShape = LambadaGrantsShape> = {
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
    const envVars = resolveEnvironment(context, {
        name: schedule.name,
        resources: schedule.resources,
        environmentVariables: schedule.environmentVariables,
    })
    const artifact = isLambdaFolder(schedule.callback) ? schedule.callback : bundleOf(context.bundles, schedule.name)

    const handler = createLambda<ScheduleEvent, void>(
        schedule.name,
        environment,
        artifact ?? schedule.callback,
        schedule.policyStatements ?? [],
        envVars,
        grants,
        undefined,
        mergeOptions(schedule.lambdaOptions, context.api?.lambdaOptions),
        `${schedule.name} in ${environment} on ${expression}`,
        context.globalTags
    )

    return aws.cloudwatch.onSchedule(`${schedule.name}-${environment}`, expression, handler)
}

export const createSchedules = (
    context: LambadaResources,
    definitions?: readonly LambadaScheduleDefinition[]
): EventRuleEventSubscription[] =>
    (definitions ?? []).map(definition => createSchedule(context, asCreator<LambdaSchedule<any>>(definition)(context)))
