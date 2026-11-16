import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments, run } from '..'

/** Inputs of every RestApi the stacks below register, by its resource name. */
const restApis = new Map<string, Record<string, any>>()

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        if (args.type === 'aws:apigateway/restApi:RestApi') restApis.set(args.name, args.inputs)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, invokeArn: `invoke:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

let stacks = 0
/** The endpoint configuration the stack's RestApi is registered with, as the engine receives it. */
const endpointConfiguration = async (api: Partial<NonNullable<LambadaRunArguments['api']>>) => {
    const environment = `t${stacks++}`
    const result = run('proj', environment, {
        bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
        api: {
            endpointDefinitions: [{ name: 'ping', path: '/ping', method: 'GET', callbackDefinition: async () => ({}) }],
            ...api,
        },
    } as LambadaRunArguments)
    await settled(result.api!.restAPI.id)
    const inputs = restApis.get(`proj-${environment}`)
    expect(inputs).toBeDefined()
    return inputs!.endpointConfiguration
}

describe('the RestApi endpoint configuration', () => {
    // Public APIs keep the configuration every release before this one registered, so deployed
    // stacks see no diff: no ipAddressType, which lets the provider keep whatever AWS reports.
    test('is EDGE with no address type when no gateway type is given', async () => {
        expect(await endpointConfiguration({})).toStrictEqual({ types: 'EDGE' })
    })

    test.each(['EDGE', 'REGIONAL'] as const)('is %s with no address type for a public API', async gatewayType => {
        expect(await endpointConfiguration({ gatewayType })).toStrictEqual({ types: gatewayType })
    })

    // AWS serves private REST APIs over dualstack only. Left unset, the provider keeps the address
    // type it recorded for the API, and a recorded ipv4 fails the plan when an API turns private.
    test('is dualstack for a PRIVATE API', async () => {
        expect(await endpointConfiguration({ gatewayType: 'PRIVATE', vpcEndpointIds: ['vpce-1'] })).toStrictEqual({
            types: 'PRIVATE',
            vpcEndpointIds: ['vpce-1'],
            ipAddressType: 'dualstack',
        })
    })

    test('is dualstack for a PRIVATE API given no VPC endpoints', async () => {
        expect(await endpointConfiguration({ gatewayType: 'PRIVATE' })).toStrictEqual({
            types: 'PRIVATE',
            ipAddressType: 'dualstack',
        })
    })
})
