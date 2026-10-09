import { describe, expect, test } from 'bun:test'
import { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import { AuthorizerSelection, createAuthorization, LambadaAuthorizers, styleProblems } from './authorizers'
import { PoolsResult } from './pools'
import { createProxyIntegrationCompat } from '../api/createProxyIntegration'
import { LambadaResources } from '../context'

const pool = (arn: string) => ({ ref: { id: `${arn}-id`, arn }, envKeyName: 'POOL', definition: { id: '', arn, envKeyName: 'POOL' } })
const pools: PoolsResult = { users: pool('arn:users'), admins: pool('arn:admins') }

const lambda = (authorizerName?: string) => ({
    authorizerName, parameterName: 'X-Secret', parameterLocation: 'header', authType: 'custom', type: 'request',
    handler: async () => ({}),
}) as unknown as LambdaAuthorizer

const definitions: LambadaAuthorizers = {
    userPool: { pool: 'users' },
    admin: { pool: 'admins' },
    orphan: { pool: 'ghosts' },
    secure: lambda('anotherName'),
}

const shape = (a: any): object => 'providerARNs' in a
    ? { cognito: a.authorizerName, pools: a.providerARNs }
    : { lambda: a.authorizerName }

describe('a method runs the one authorizer it names', () => {
    test.each([
        { selection: 'userPool', expected: [{ cognito: 'userPool', pools: ['arn:users'] }] },
        { selection: 'admin', expected: [{ cognito: 'admin', pools: ['arn:admins'] }] },
        { selection: 'secure', expected: [{ lambda: 'secure' }] },
        { selection: false, expected: [] },
    ] as { selection: AuthorizerSelection, expected: object[] }[])('$selection', ({ selection, expected }) => {
        const { authorizers, missing } = createAuthorization(definitions, pools, undefined).select('fn', selection)

        expect(missing).toEqual([])
        expect(authorizers.map(shape)).toEqual(expected)
    })

    test.each([
        { defaults: 'secure', expected: [{ lambda: 'secure' }] },
        { defaults: false, expected: [] },
        { defaults: undefined, expected: [] },
    ] as { defaults: AuthorizerSelection | undefined, expected: object[] }[])('left out, the default $defaults', ({ defaults, expected }) => {
        expect(createAuthorization(definitions, pools, defaults).resolve('fn', undefined).map(shape)).toEqual(expected)
    })

    test('one authorizer per name, shared by every method selecting it', () => {
        const authorization = createAuthorization(definitions, pools, undefined)

        expect(authorization.resolve('a', 'userPool')[0]).toBe(authorization.resolve('b', 'userPool')[0])
        expect(authorization.resolve('a', 'secure')[0]).toBe(authorization.resolve('b', 'secure')[0])
    })

    test('leaves the declared lambda authorizer as it was written', () => {
        createAuthorization(definitions, pools, undefined).resolve('fn', 'secure')

        expect(definitions.secure).toMatchObject({ authorizerName: 'anotherName' })
    })
})

describe('a name the stack cannot resolve is reported', () => {
    test.each([
        { selection: 'ghost', missing: { kind: 'authorizer', name: 'ghost', available: Object.keys(definitions) } },
        { selection: 'constructor', missing: { kind: 'authorizer', name: 'constructor', available: Object.keys(definitions) } },
        { selection: 'orphan', missing: { kind: 'pool', name: 'ghosts', available: ['users', 'admins'] } },
    ])('$selection', ({ selection, missing }) => {
        const authorization = createAuthorization(definitions, pools, undefined)

        expect(authorization.select('fn', selection)).toEqual({ authorizers: [], missing: [{ functionName: 'fn', ...missing, available: [...missing.available] }] })
        expect(() => authorization.resolve('fn', selection)).toThrow(new RegExp(`granted but absent[\\s\\S]*fn\\s+${missing.kind} '${missing.name}'`))
    })

    test.each(['a+b', 'a.b', 'with space', '', 'x'.repeat(1025)])('a name API Gateway or Lambda refuses: %#', name => {
        expect(() => createAuthorization({ [name]: { pool: 'users' } }, pools, undefined)).toThrow(`authorizer '${name}'`)
    })
})

describe('an endpoint written in the other style from its stack', () => {
    const named = createAuthorization(definitions, pools, undefined)

    test.each([
        { authorization: named, auth: { useCognitoAuthorizer: false }, reason: /sets auth.useCognitoAuthorizer, but run\(\) declares authorizers by name/ },
        { authorization: named, auth: { lambdaAuthorizer: lambda() }, reason: /sets auth.lambdaAuthorizer/ },
        { authorization: undefined, auth: { authorizer: false as const }, reason: /selects auth.authorizer, but run\(\) declares none/ },
    ])('$auth', ({ authorization, auth, reason }) => {
        expect(styleProblems(authorization, 'fn', auth)).toEqual([expect.stringMatching(reason)])
    })

    test.each([
        { authorization: named, auth: { authorizer: 'secure', useApiKey: true } },
        { authorization: named, auth: undefined },
        { authorization: undefined, auth: { useCognitoAuthorizer: true } },
    ])('matching: $auth', ({ authorization, auth }) => {
        expect(styleProblems(authorization, 'fn', auth)).toEqual([])
    })
})

describe('a proxy integration in a stack declaring authorizers by name', () => {
    const context = { authorizers: [], authorization: createAuthorization(definitions, pools, 'userPool') } as unknown as LambadaResources

    test.each([
        { enableAuth: true, expected: [{ cognito: 'userPool', pools: ['arn:users'] }] },
        { enableAuth: false, expected: [] },
    ] as { enableAuth: boolean, expected: object[] }[])('enableAuth $enableAuth', ({ enableAuth, expected }) => {
        const route = createProxyIntegrationCompat({ path: '/p', targetUri: 'https://x', enableAuth }, context) as { authorizers: unknown[] }
        expect(route.authorizers.map(shape)).toEqual(expected)
    })
})
