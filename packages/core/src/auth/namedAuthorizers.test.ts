import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import { createEndpoint, createEndpointSimpleCors, LambadaResources, LambadaRunArguments, run } from '..'

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, invokeArn: `invoke:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const lambdaAuthorizer = (name: string): LambdaAuthorizer => ({
    authorizerName: `${name}-own-name`,
    parameterName: 'X-Secret',
    parameterLocation: 'header',
    authType: 'custom',
    type: 'request',
    identitySource: ['method.request.header.X-Secret'],
    handler: new aws.lambda.Function(`${name}-handler`, { role: 'arn:role', runtime: 'nodejs24.x', handler: 'index.main', code: new pulumi.asset.AssetArchive({}) }),
})

const endpoint = (path: string, auth?: object) => ({ name: path.slice(1), path, method: 'GET' as const, callbackDefinition: async () => ({}), auth })

let stacks = 0
/** The OpenAPI body API Gateway imports: which authorizers exist, and which each path runs. */
const deploy = async (args: Partial<LambadaRunArguments>) => {
    const { api } = run('proj', `t${stacks++}`, {
        bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
        ...args,
    } as LambadaRunArguments)

    const body = JSON.parse((await settled(api!.restAPI.body))!)
    const security = Object.fromEntries(Object.entries(body.paths as Record<string, any>)
        .filter(([path]) => !path.includes('openapi'))
        .map(([path, methods]) => [path, methods.get?.security?.map((s: object) => Object.keys(s)[0]) ?? []]))
    return { definitions: body.securityDefinitions ?? {}, security }
}

describe('a stack declaring authorizers by name', () => {
    test('emits one authorizer per name, each method running the one it selected', async () => {
        const { definitions, security } = await deploy({
            poolsRef: { users: { id: 'users-id', arn: 'arn:users', envKeyName: 'U' } },
            auth: {
                authorizers: { userPool: { pool: 'users' }, secure: lambdaAuthorizer('secure') },
                defaultAuthorizer: 'secure',
            },
            api: {
                endpointDefinitions: [
                    endpoint('/default'),
                    endpoint('/users', { authorizer: 'userPool' }),
                    endpoint('/users-again', { authorizer: 'userPool' }),
                    endpoint('/public', { authorizer: false }),
                ],
            },
        } as Partial<LambadaRunArguments>)

        expect(security).toEqual({
            '/api/default': ['secure'],
            '/api/users': ['userPool'],
            '/api/users-again': ['userPool'],
            '/api/public': [],
        })
        expect(Object.keys(definitions).sort()).toEqual(['secure', 'userPool'])
        expect(definitions.userPool['x-amazon-apigateway-authorizer'].providerARNs).toEqual(['arn:users'])
        expect(definitions.secure['x-amazon-apigateway-authtype']).toBe('custom')
    })

    test('builds no stack-wide authorizer from createCognito: its pool authorizes where it is selected', async () => {
        const { security } = await deploy({
            auth: { createCognito: true, authorizers: { userPool: { pool: 'userPool' } } },
            api: { endpointDefinitions: [endpoint('/open'), endpoint('/closed', { authorizer: 'userPool' })] },
        } as Partial<LambadaRunArguments>)

        expect(security).toEqual({ '/api/open': [], '/api/closed': ['userPool'] })
    })

    test('reports every bad name before building anything', () => {
        expect(() => run('proj', 'bad', {
            poolsRef: { users: { id: 'users-id', arn: 'arn:users', envKeyName: 'U' } },
            auth: {
                authorizers: { userPool: { pool: 'users' }, orphan: { pool: 'ghosts' } },
                defaultAuthorizer: 'orphan',
            },
            api: {
                endpointDefinitions: [
                    endpoint('/ghost', { authorizer: 'ghost' }),
                    endpoint('/old', { useCognitoAuthorizer: true }),
                    { path: '/proxy', targetUri: 'https://example.com', enableAuth: false },
                    { path: '/proxy-ghost', targetUri: 'https://example.com', auth: { authorizer: 'ghost' } },
                ],
            },
        } as unknown as LambadaRunArguments)).toThrow(
            /3 resources that are granted but absent[\s\S]*\(stack default\)\s+pool 'ghosts'[\s\S]*ghost\s+authorizer 'ghost'[\s\S]*\/proxy-ghost\s+authorizer 'ghost'[\s\S]*2 invalid declarations[\s\S]*old: sets auth.useCognitoAuthorizer[\s\S]*\/proxy: sets enableAuth/
        )
    })

    test.each(['lambdaAuthorizers', 'authorizerPools', 'extraAuthorizers'])('refuses auth.%s beside it', field => {
        expect(() => run('proj', 'mixed', {
            auth: { authorizers: {}, [field]: [] },
        } as unknown as LambadaRunArguments)).toThrow(`also sets auth.${field}`)
    })

    const direct = (enableAuth?: boolean, lambdaAuthorizer?: LambdaAuthorizer) => (context: LambadaResources) =>
        createEndpoint('direct', context, '/direct', 'GET', { functionFolder: '.', handler: 'index.main' }, [], undefined, enableAuth, undefined, undefined, lambdaAuthorizer)

    test.each([
        { name: 'enableAuth: false', creator: direct(false), reason: 'sets enableAuth' },
        { name: 'a lambdaAuthorizer', creator: direct(undefined, lambdaAuthorizer('legacy')), reason: 'sets auth.lambdaAuthorizer' },
    ])('refuses a creator calling createEndpoint with $name', ({ creator, reason }) => {
        expect(() => run('proj', 'direct', {
            bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
            auth: { authorizers: { secure: lambdaAuthorizer('secure3') }, defaultAuthorizer: 'secure' },
            api: { endpointDefinitions: [creator] },
        } as unknown as LambadaRunArguments)).toThrow(`direct: ${reason}`)
    })

    test('a creator calling createEndpoint without auth runs the default', async () => {
        const { security } = await deploy({
            auth: { authorizers: { secure: lambdaAuthorizer('secure4') }, defaultAuthorizer: 'secure' },
            api: { endpointDefinitions: [direct()] },
        } as unknown as Partial<LambadaRunArguments>)

        expect(security).toEqual({ '/api/direct': ['secure'] })
    })

    test.each(['constructor', 'toString', 'api_key'])('refuses the name %p, which awsx keeps for itself', name => {
        expect(() => run('proj', 'reserved', {
            bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
            poolsRef: { users: { id: 'users-id', arn: 'arn:users', envKeyName: 'U' } },
            auth: { authorizers: { [name]: { pool: 'users' } }, defaultAuthorizer: name, useApiKey: {} },
            api: { endpointDefinitions: [endpoint('/reserved')] },
        } as unknown as LambadaRunArguments)).toThrow(`Cannot declare the authorizer '${name}'`)
    })

    test('createEndpointSimpleCors selects by name too', async () => {
        const { security } = await deploy({
            auth: { authorizers: { secure: lambdaAuthorizer('secure5') }, defaultAuthorizer: 'secure' },
            api: {
                endpointDefinitions: [
                    (context: LambadaResources) => createEndpointSimpleCors('cors-public', context, '/cors-public', 'GET', async () => ({}), [], { authorizer: false }),
                    (context: LambadaResources) => createEndpointSimpleCors('cors-default', context, '/cors-default', 'GET', async () => ({}), []),
                ],
            },
        } as unknown as Partial<LambadaRunArguments>)

        expect(security).toEqual({ '/api/cors-public': [], '/api/cors-default': ['secure'] })
    })
})
