import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import { LambadaRunArguments, run } from '..'

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
                ],
            },
        } as unknown as LambadaRunArguments)).toThrow(
            /2 resources that are granted but absent[\s\S]*\(stack default\)\s+pool 'ghosts'[\s\S]*ghost\s+authorizer 'ghost'[\s\S]*1 invalid declaration[\s\S]*old: sets auth.useCognitoAuthorizer/
        )
    })

    test.each(['lambdaAuthorizers', 'authorizerPools', 'extraAuthorizers'])('refuses auth.%s beside it', field => {
        expect(() => run('proj', 'mixed', {
            auth: { authorizers: {}, [field]: [] },
        } as unknown as LambadaRunArguments)).toThrow(`also sets auth.${field}`)
    })
})
