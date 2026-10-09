import { describe, expect, test } from 'bun:test'
import type * as aws from '@pulumi/aws'
import type { QueueEventSubscriptionArgs } from '@pulumi/aws/sqs'
import type { EmbroideryEnvironmentVariables } from '..'
import type { LambdaFolder, LambdaOptions } from '.'
import type { AsyncFailures } from './asyncFailures'
import type { LambdaSubscription, SnsSubscriptionFilter, SubscriptionCallback } from '../messaging/createSubscription'
import type { LambdaQueueHandler, QueueHandlerCallback, QueueHandlerFilter } from '../queue/createQueueHandler'
import type { QueueResultItem } from '../queue'
import type { LambdaSchedule, Schedule, ScheduleCallback } from '../schedules'
import type { LambadaGrantsShape, LambadaResourceRequest, ResourceRef } from '../resources/grants'

/**
 * Compile-time. Each kind is now its trigger over one shared function type; these pin that the
 * kinds a service writes are the same types they were, field for field.
 */

type Flat<T> = { [K in keyof T]: T[K] }
type Equals<A, B> = (<T>() => T extends Flat<A> ? 1 : 2) extends (<T>() => T extends Flat<B> ? 1 : 2) ? true : false
const same = <A, B>(proof: Equals<A, B>) => proof

type Names = { table: 'pets', envVar: 'STRIPE_KEY' }
type SubscriptionArgs = LambdaSubscription['subscriptionArgs']

type Subscription<TNames extends LambadaGrantsShape> = AsyncFailures & {
    name: string
    callback: SubscriptionCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables
    resources: LambadaResourceRequest<TNames>
    subscriptionArgs?: SubscriptionArgs
    lambdaOptions?: LambdaOptions
    filter?: SnsSubscriptionFilter
}

type QueueHandler<TNames extends LambadaGrantsShape> = {
    name: string
    queue: ResourceRef<QueueResultItem>
    callback: QueueHandlerCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables,
    resources: LambadaResourceRequest<TNames>
    lambdaOptions?: LambdaOptions,
    subscriptionArgs?: QueueEventSubscriptionArgs | undefined
    filter?: QueueHandlerFilter
    reportBatchItemFailures?: boolean
    maximumConcurrency?: number
}

type ScheduleDeclaration<TNames extends LambadaGrantsShape> = AsyncFailures & {
    name: string
    schedule: Schedule
    callback: ScheduleCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables
    resources: LambadaResourceRequest<TNames>
    lambdaOptions?: LambdaOptions
}

describe('every kind is the type it was, written over the shared function type', () => {
    test('subscription', () => {
        expect(same<LambdaSubscription, Subscription<LambadaGrantsShape>>(true)).toBe(true)
        expect(same<LambdaSubscription<Names>, Subscription<Names>>(true)).toBe(true)
    })

    test('queue handler', () => {
        expect(same<LambdaQueueHandler, QueueHandler<LambadaGrantsShape>>(true)).toBe(true)
        expect(same<LambdaQueueHandler<Names>, QueueHandler<Names>>(true)).toBe(true)
    })

    test('schedule', () => {
        expect(same<LambdaSchedule, ScheduleDeclaration<LambadaGrantsShape>>(true)).toBe(true)
        expect(same<LambdaSchedule<Names>, ScheduleDeclaration<Names>>(true)).toBe(true)
    })
})
