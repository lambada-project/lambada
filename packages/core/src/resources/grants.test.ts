import { describe, expect, test } from 'bun:test'
import { createPools } from '../auth/pools'
import { createCustom } from '../custom'
import { findForeignActions, GrantContext, LambadaGrants, isLambadaGrants, resolveGrants, toLambdaResources } from './grants'

const item = (name: string) => ({ definition: { name, envKeyName: `${name.toUpperCase()}_NAME` }, ref: { name } })

const context = {
    databases: { pets: item('pets') },
    secrets: { apiKey: item('apiKey') },
    messaging: { statusChanged: item('statusChanged') },
    queues: { provisioning: item('provisioning') },
    kmsKeys: { signing: item('signing') },
    pools: createPools('p', 'test', {}, undefined, undefined, {
        userPool: { id: 'pool-id', arn: 'arn:pool', envKeyName: 'USER_POOL_ID' },
    }).pools,
    custom: createCustom({
        search: { service: 'es', resources: 'arn:aws:es:us-east-1:123456789012:domain/pets/*', environment: { SEARCH_ENDPOINT: 'search-pets' } },
    }),
} as unknown as GrantContext

describe('toLambdaResources', () => {
    test('resolves every kind against the definitions run() already holds', () => {
        const grants = toLambdaResources(context, { name: 'getPet', resources: {
            table: { pets: ['dynamodb:GetItem'] },
            topic: { statusChanged: ['sns:Publish'] },
            queue: { provisioning: ['sqs:SendMessage'] },
            secret: { apiKey: ['secretsmanager:GetSecretValue'] },
            kmsKey: { signing: ['kms:Decrypt'] },
            pool: { userPool: ['cognito-idp:ListUsers'] },
            custom: { search: ['es:ESHttpGet'] },
        } })

        expect(grants.map(x => Object.keys(x).filter(k => k !== 'access')).flat()).toEqual([
            'table',
            'topic',
            'queue',
            'secret',
            'kmsKey',
            'pool',
            'custom',
        ])
    })

    test('a pool is a resource like any other, so createLambda publishes its envKeyName', () => {
        const [grant] = toLambdaResources(context, { name: 'getPet', resources: { pool: { userPool: ['cognito-idp:ListUsers'] } } })

        expect(grant.pool?.envKeyName).toBe('USER_POOL_ID')
        expect(grant.pool?.ref).toEqual({ id: 'pool-id', arn: 'arn:pool' })
    })

    test('copies the access array rather than aliasing the declaration', () => {
        const access = ['dynamodb:GetItem'] as const
        const [grant] = toLambdaResources(context, { name: 'getPet', resources: { table: { pets: access } } })

        expect(grant.access).toEqual(['dynamodb:GetItem'])
        expect(grant.access).not.toBe(access)
    })

    test('is empty for a function that needs nothing', () => {
        expect(toLambdaResources(context, { name: 'getPet', resources: {} })).toEqual([])
    })

    test.each([
        ['table', { table: { missing: ['dynamodb:GetItem'] } }],
        ['topic', { topic: { missing: ['sns:Publish'] } }],
        ['queue', { queue: { missing: ['sqs:SendMessage'] } }],
        ['secret', { secret: { missing: ['secretsmanager:GetSecretValue'] } }],
        ['kmsKey', { kmsKey: { missing: ['kms:Decrypt'] } }],
        ['pool', { pool: { missing: ['cognito-idp:ListUsers'] } }],
        ['custom', { custom: { missing: ['es:ESHttpGet'] } }],
    ] as [string, LambadaGrants][])('throws naming the %s the stack does not carry', (kind, grants) => {
        expect(() => toLambdaResources(context, { name: 'getPet', resources: grants })).toThrow(
            `Resource not found: getPet needs ${kind} 'missing', which is absent from the stack.`,
        )
    })
})

describe('a custom grant', () => {
    test.each([
        { actions: ['s3:GetObject'], foreign: 's3:GetObject' },
        { actions: ['es:ESHttpGet', 'execute-api:Invoke'], foreign: 'execute-api:Invoke' },
        // A service whose name another one starts with is still another service.
        { actions: ['ess:Describe'], foreign: 'ess:Describe' },
    ])('refuses $foreign, outside the service its resource names', ({ actions, foreign }) => {
        const resources = { custom: { search: actions } } as LambadaGrants

        expect(() => toLambdaResources(context, { name: 'getPet', resources })).toThrow(`getPet: grants custom 'search' ${foreign}, outside its service 'es'.`)
        expect(findForeignActions(context, { name: 'getPet', resources })).toEqual([`getPet: grants custom 'search' ${foreign}, outside its service 'es'.`])
    })

    test('reports nothing for actions of its service, or for a name preflight reports as missing', () => {
        expect(findForeignActions(context, { name: 'getPet', resources: { custom: { search: ['es:ESHttpGet', 'ES:ESHttpPost'] } } })).toEqual([])
        expect(findForeignActions(context, { name: 'getPet', resources: { custom: { missing: ['s3:GetObject'] } } })).toEqual([])
    })

    test.each(['', 'es:', 'ES', 'execute api'])('refuses %p as a service', service => {
        expect(() => createCustom({ search: { service, resources: 'arn:x' } })).toThrow(`Cannot declare the custom resource 'search': service '${service}'`)
    })
})

describe('resolveGrants', () => {
    test('tells the two forms apart by shape alone', () => {
        expect(isLambadaGrants([])).toBe(false)
        expect(isLambadaGrants({ table: { pets: ['dynamodb:GetItem'] } })).toBe(true)
        expect(isLambadaGrants(undefined)).toBe(false)
    })

    test('treats a missing request as no grants', () => {
        expect(resolveGrants(context, { name: 'getPet', resources: undefined })).toEqual([])
    })

    test('copies a legacy list, so a caller reusing one array does not collect grants across handlers', () => {
        const legacy = [{ arn: 'arn:thing', access: ['sqs:SendMessage'] }]
        const resolved = resolveGrants(context, { name: 'getPet', resources: legacy })

        expect(resolved).toEqual(legacy)
        expect(resolved).not.toBe(legacy)

        resolved.push({ arn: 'arn:appended', access: ['kms:Decrypt'] })
        expect(legacy).toHaveLength(1)
    })

    test('resolves each function in whichever form it was written', () => {
        expect(resolveGrants(context, { name: 'getPet', resources: { table: { pets: ['dynamodb:GetItem'] } } })[0]).toHaveProperty('table')
        expect(resolveGrants(context, { name: 'getPet', resources: [{ arn: 'arn:thing', access: ['sqs:SendMessage'] }] })[0]).toHaveProperty('arn')
    })
})
