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
import type { EmbroideryCallback, HTTP_METHODS, LambadaEndpointArgs, OpenApiFactory, OpenApiFactoryLike } from '../api/createEndpoint'
import type { QueueArgs } from '@pulumi/aws/sqs'
import type { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import type { AuthorizerSelection } from '../auth/authorizers'

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

/** LambadaEndpointArgs as 1.33.0 published it. */
type EndpointDeclaration<TNames extends LambadaGrantsShape, TOpenApi extends OpenApiFactoryLike | undefined> = {
    name?: string,
    path: string,
    method: HTTP_METHODS,
    useBundle?: LambdaFolder,
    callbackDefinition: EmbroideryCallback,
    resources?: LambadaResourceRequest<TNames>,
    extraHeaders?: {},
    cache?: {
        control?: string
    },
    environmentVariables?: EmbroideryEnvironmentVariables,
    openapi?: TOpenApi
    webhook?: {
        wrapInQueue: boolean,
        options?: QueueArgs,
        messageGroupId?: {
            field: string
            source: "BODY"
        }
    },
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
        authorizer?: AuthorizerSelection
    },
    options?: LambdaOptions
}

describe('an endpoint is the type it was, with lambdaOptions beside options', () => {
    test('every field it had is still there, typed as it was', () => {
        expect(same<Omit<LambadaEndpointArgs, 'lambdaOptions'>, EndpointDeclaration<LambadaGrantsShape, OpenApiFactory>>(true)).toBe(true)
        expect(same<Omit<LambadaEndpointArgs<Names, undefined>, 'lambdaOptions'>, EndpointDeclaration<Names, undefined>>(true)).toBe(true)
    })

    test('lambdaOptions is typed as options was', () => {
        expect(same<Pick<LambadaEndpointArgs, 'lambdaOptions'>, { lambdaOptions?: LambdaOptions }>(true)).toBe(true)
    })
})
