import { describe, expect, test } from 'bun:test'
import { run } from '..'
import { LambadaEndpointArgs } from '../api/createEndpoint'
import { LambadaSubscriptionHandler } from '../messaging/createSubscription'
import { LambdaQueueHandler } from '../queue/createQueueHandler'
import { LambadaGrantsShape } from './grants'

/**
 * Compile-time. The assertion is that these literals type-check; the runtime body only keeps the
 * test runner honest.
 */

const tables = { pets: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS_TABLE_NAME' } }
const topics = { statusChanged: { name: 'statusChanged', envKeyName: 'STATUS_CHANGED_TOPIC_ARN' } }
const queues = { provisioning: { name: 'provisioning', envKeyName: 'PROVISIONING_QUEUE_URL' } }
const pools = { userPool: { id: 'pool-id', arn: 'arn:pool', envKeyName: 'USER_POOL_ID' } }
const environmentVariables = { STRIPE_KEY: 'sk', SEGMENT_KEY: 'sg' }

/** Narrowed against the stack's own definitions, so a misspelled name is a compile error. */
type Names = {
    table: keyof typeof tables
    topic: keyof typeof topics
    queue: keyof typeof queues
    pool: keyof typeof pools
    envVar: keyof typeof environmentVariables
}

const endpoint = {
    name: 'getPet',
    path: '/pets/{id}',
    method: 'GET',
    resources: {
        table: { pets: ['dynamodb:GetItem', 'dynamodb:Query'] },
        pool: { userPool: ['cognito-idp:ListUsers'] },
        envVar: ['STRIPE_KEY'],
    },
    auth: { useCognitoAuthorizer: true },
    callbackDefinition: async () => ({ statusCode: 200, body: '{}' }),
} satisfies LambadaEndpointArgs<Names>

const subscription = {
    name: 'onStatusChanged',
    topic: 'statusChanged',
    resources: { table: { pets: ['dynamodb:PutItem'] } },
    callback: async () => { },
} satisfies LambadaSubscriptionHandler<Names>

const queueHandler = {
    name: 'markReady',
    queue: 'provisioning',
    resources: { table: { pets: ['dynamodb:UpdateItem'] } },
    callback: async () => { },
} satisfies LambdaQueueHandler<Names>

/** Without the narrowing, any name still compiles — the generic is opt-in. */
const looseEndpoint = {
    name: 'anything',
    path: '/anything',
    method: 'GET',
    resources: { table: { whateverTheStackCallsIt: ['dynamodb:GetItem'] } },
    callbackDefinition: async () => ({ statusCode: 200, body: '{}' }),
} satisfies LambadaEndpointArgs

const runArguments = {
    tables,
    messages: topics,
    queues,
    poolsRef: pools,
    environmentVariables,
    globalEnvironmentVariables: { LAMBADA_SHOW_ALL_ERRORS: 'true' },
    api: { endpointDefinitions: [endpoint, looseEndpoint] },
    messageHandlerDefinitions: [subscription],
    queueHandlerDefinitions: [queueHandler],
} satisfies Parameters<typeof run>[2]

/**
 * Each of these is a compile error, which is the point of `Names`:
 *
 *   resources: { table: { pet: ['dynamodb:GetItem'] } }      // no such table
 *   resources: { table: { pets: ['banana'] } }               // not an IAM action
 *   resources: { table: { pets: ['sns:Publish'] } }          // wrong service for a table
 *   resources: { envVar: ['STRIPE_KEYY'] }                      // no such value in the pool
 */
const stackNamesStayOptional: LambadaGrantsShape = {}

describe('the declarative shapes', () => {
    test('type-check, which is the assertion', () => {
        expect([endpoint.name, subscription.name, queueHandler.name]).toEqual([
            'getPet',
            'onStatusChanged',
            'markReady',
        ])
        expect(Object.keys(runArguments.poolsRef)).toEqual(['userPool'])
        expect(stackNamesStayOptional).toEqual({})
    })
})
