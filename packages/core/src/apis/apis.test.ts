import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments, run, SignedApi } from '..'
import { grantedRouteArns } from '.'
import { signedRoutes } from '../api/sigv4'

const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        return { id: `${args.name}-id`, state: {
            ...args.inputs, arn: `arn:${args.name}`, name: args.inputs.name ?? args.name,
            executionArn: `arn:aws:execute-api:us-east-1:123456789012:${args.name}-id`,
            invokeUrl: `https://${args.name}-id.execute-api.us-east-1.amazonaws.com/app`,
        } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

const users: SignedApi = {
    executionArn: 'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5',
    url: 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/app',
    stage: 'app',
    routes: ['GET /api/users/{id}', 'POST /api/users/{id}/lock', 'ANY /api/admin/{proxy+}'],
}

const nested: SignedApi = {
    ...users,
    routes: ['GET /api/users/{id}', 'GET /api/users/{id}/sessions', 'GET /api/users/me', 'POST /api/users/{id}/lock'],
}

describe('the routes an API signs', () => {
    test('are the operations whose security requires a signature, with or without a key', () => {
        expect(signedRoutes({
            paths: {
                '/api/users/{id}': { get: { security: [{ sigv4: [] }] }, delete: { security: [{ sigv4: [], api_key: [] }] } },
                '/api/admin/{proxy+}': { 'x-amazon-apigateway-any-method': { security: [{ sigv4: [] }] } },
                '/api/pets': { get: { security: [{ userPool: [] }] }, post: {} },
            },
        })).toEqual(['GET /api/users/{id}', 'DELETE /api/users/{id}', 'ANY /api/admin/{proxy+}'])
    })
})

describe('a grant whose wildcard reaches another signed route', () => {
    test('is refused, naming every route it reaches', () => {
        expect(() => grantedRouteArns('getUser', 'users', nested, ['GET /api/users/{id}'])).toThrow(
            "getUser: grants api 'users' GET /api/users/{id}, which IAM also matches for GET /api/users/{id}/sessions, GET /api/users/me"
        )
    })

    test.each([
        { name: 'with every route it reaches', routes: ['GET /api/users/{id}', 'GET /api/users/{id}/sessions', 'GET /api/users/me'] },
        { name: 'a static route, which API Gateway prefers to a parameter beside it', routes: ['GET /api/users/me'] },
        { name: 'a deeper route, which nothing nests under', routes: ['GET /api/users/{id}/sessions'] },
        { name: 'another method on the same path', routes: ['POST /api/users/{id}/lock'] },
    ])('is granted $name', ({ routes }) => {
        expect(grantedRouteArns('getUser', 'users', nested, routes)).toHaveLength(routes.length)
    })

    test('a greedy route reaches what nests under it, and a route nested in it is preferred over it', () => {
        const proxied: SignedApi = { ...users, routes: ['ANY /api/admin/{proxy+}', 'GET /api/admin/audit'] }

        expect(() => grantedRouteArns('admin', 'users', proxied, ['ANY /api/admin/{proxy+}'])).toThrow('also matches for GET /api/admin/audit')
        expect(grantedRouteArns('audit', 'users', proxied, ['GET /api/admin/audit'])).toHaveLength(1)
    })
})

describe('a granted route', () => {
    test('is the route on the stage, with every parameter a wildcard, as IAM matches the request path', () => {
        expect(grantedRouteArns('lockUser', 'users', users, ['POST /api/users/{id}/lock', 'ANY /api/admin/{proxy+}'])).toEqual([
            'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/POST/api/users/*/lock',
            'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/*/api/admin/*',
        ])
    })

    test.each(['GET /api/pets', 'DELETE /api/users/{id}', 'GET /api/users/{userId}'])('is refused when the API does not sign it: %s', route => {
        expect(() => grantedRouteArns('lockUser', 'users', users, [route]))
            .toThrow(`lockUser: grants api 'users' ${route}, which it does not sign. It signs: GET /api/users/{id}, POST /api/users/{id}/lock, ANY /api/admin/{proxy+}.`)
    })
})

const handler = (name: string, resources: object) =>
    ({ name, schedule: { every: { minutes: 5 } }, callback: { functionFolder: '.', handler: 'index.main' }, resources })

const caller = (environment: string, functions: object[], api: pulumi.Input<SignedApi> = users) => run('proj', environment, {
    bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
    apisRef: { users: { api, envKeyName: 'USERS_API_URL' } },
    scheduleDefinitions: functions,
} as unknown as LambadaRunArguments)

const lambda = (name: string) => built.find(r => r.type === 'aws:lambda/function:Function' && r.name === name)!
const policyOf = (name: string) => {
    const policy = built.find(r => r.type === 'aws:iam/policy:Policy' && r.name.startsWith(name))!.inputs.policy
    return typeof policy === 'string' ? JSON.parse(policy) : policy
}

describe('a caller granted routes of another stack', () => {
    test('may invoke exactly those routes, and reads the URL', async () => {
        caller('grants', [handler('lockUser', { api: { users: ['GET /api/users/{id}', 'POST /api/users/{id}/lock'] } })])
        await settle()

        expect(policyOf('lock-user-grants').Statement).toContainEqual({
            Effect: 'Allow', Action: ['execute-api:invoke'],
            Resource: [
                'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/GET/api/users/*',
                'arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/POST/api/users/*/lock',
            ],
        })
        expect(lambda('lockUser-grants').inputs.environment.variables).toMatchObject({ USERS_API_URL: users.url })
    })

    test('a function not granted it neither invokes it nor reads the URL', async () => {
        caller('plain', [handler('tick', {})])
        await settle()

        expect(lambda('tick-plain').inputs.environment?.variables ?? {}).not.toHaveProperty('USERS_API_URL')
        expect(JSON.stringify(policyOf('tick-plain'))).not.toContain('execute-api')
    })

    test('an API the stack lacks is reported before anything is built', () => {
        expect(() => caller('missing', [handler('lockUser', { api: { orders: ['GET /api/orders'] } })]))
            .toThrow(/granted but absent[\s\S]*lockUser\s+api 'orders'/)
    })
})

describe('an API whose routes are signed', () => {
    test('publishes them for a caller', async () => {
        const { signedApi } = run('owner', 'publish', {
            bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
            auth: { authorizers: { internal: { iam: true } } },
            api: {
                endpointDefinitions: [
                    { name: 'getUser', path: '/users/{id}', method: 'GET', callbackDefinition: async () => ({}), auth: { authorizer: 'internal' } },
                    { name: 'health', path: '/health', method: 'GET', callbackDefinition: async () => ({}) },
                ],
            },
        } as unknown as LambadaRunArguments)

        expect(await settled(signedApi!)).toEqual({
            executionArn: expect.stringMatching(/^arn:aws:execute-api:/),
            url: expect.stringMatching(/^https:.*\/app$/),
            stage: 'app',
            routes: ['GET /api/users/{id}'],
        })
    })
})
