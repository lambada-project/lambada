import { describe, expect, test } from 'bun:test'
import { createPools } from '../auth/pools'
import { actionProblems, createCustom } from '../custom'
import { findCustomGrantProblems, GrantContext, LambadaGrants, isLambadaGrants, resolveGrants, toLambdaResources } from './grants'

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
        expect(findCustomGrantProblems(context, { name: 'getPet', resources })).toEqual([`getPet: grants custom 'search' ${foreign}, outside its service 'es'.`])
    })

    test('reports nothing for actions of its service, or for a name preflight reports as missing', () => {
        expect(findCustomGrantProblems(context, { name: 'getPet', resources: { custom: { search: ['es:ESHttpGet', 'ES:ESHttpPost'] } } })).toEqual([])
        expect(findCustomGrantProblems(context, { name: 'getPet', resources: { custom: { missing: ['s3:GetObject'] } } })).toEqual([])
    })

    test.each(['es:*', 'es:ESHttp*', 'ES:ESHttpGe?'])('refuses the wildcard %s', action => {
        const resources = { custom: { search: [action] } } as LambadaGrants
        const problem = `getPet: grants custom 'search' ${action}, a wildcard: name each action. State it in the function's policyStatements, where it is reviewed as written.`

        expect(() => toLambdaResources(context, { name: 'getPet', resources })).toThrow(problem)
        expect(findCustomGrantProblems(context, { name: 'getPet', resources })).toEqual([problem])
    })

    test.each(['', 'es:', 'ES', 'execute api'])('refuses %p as a service', service => {
        expect(() => createCustom({ search: { service, resources: 'arn:x' } })).toThrow(`Cannot declare the custom resource 'search': service '${service}'`)
    })

    test.each(['iam', 'sts'])('refuses %s, whose grants let a function give itself more', service => {
        expect(() => createCustom({ admin: { service, resources: `arn:aws:${service}::123456789012:role/pets` } }))
            .toThrow(`Cannot declare the custom resource 'admin': service '${service}' manages identities`)
    })
})

describe('a custom resource', () => {
    test.each([
        { resource: '*', problem: "'*' is not an ARN of 'es'" },
        { resource: 'arn:aws:s3:::pets', problem: "'arn:aws:s3:::pets' is not an ARN of 'es'" },
        { resource: 'arn:aws:es:*:123456789012:domain/pets', problem: 'with partition, region and account spelled out' },
        { resource: 'arn:aws:es:us-east-1:*:domain/pets', problem: 'with partition, region and account spelled out' },
        { resource: 'arn:aws:es:us-east-1:123456789012:*', problem: "names every resource of 'es'" },
        { resource: 'domain/pets', problem: "is not an ARN of 'es'" },
    ])('is refused when broader than one ARN of its service: $resource', ({ resource, problem }) => {
        expect(() => createCustom({ search: { service: 'es', resources: ['arn:aws:es:us-east-1:123456789012:domain/pets', resource] } }))
            .toThrow(problem)
    })

    test('names the ARNs of its arnService when its actions carry another prefix', () => {
        const cluster = 'arn:aws:rds:us-east-1:123456789012:cluster:pets'
        const { pets } = createCustom({ pets: { service: 'rds-data', arnService: 'rds', resources: cluster } })

        expect(() => createCustom({ pets: { service: 'rds-data', resources: cluster } })).toThrow(`'${cluster}' is not an ARN of 'rds-data'`)
        expect(actionProblems(pets, ['rds-data:ExecuteStatement'])).toEqual([])
        expect(actionProblems(pets, ['rds:DeleteDBCluster'])).toEqual(["rds:DeleteDBCluster, outside its service 'rds-data'."])
    })

    test.each(['', 'iam', 'RDS'])('refuses %p as an arnService', arnService => {
        expect(() => createCustom({ pets: { service: 'rds-data', arnService, resources: 'arn:aws:rds:us-east-1:123456789012:cluster:pets' } }))
            .toThrow(`Cannot declare the custom resource 'pets': arnService '${arnService}'`)
    })

    test.each([
        'arn:aws:es:us-east-1:123456789012:domain/pets',
        'arn:aws:es:us-east-1:123456789012:domain/pets/*',
        'arn:aws-us-gov:es:us-gov-west-1:123456789012:domain/pets',
    ])('is accepted as an ARN of its service: %s', resource => {
        expect(() => createCustom({ search: { service: 'es', resources: resource } })).not.toThrow()
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
