import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaResources, LambadaRunArguments, run } from '..'
import { toWrapperConfig } from '../api/callbackWrapper'

const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, invokeArn: `invoke:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const endpoint = (tuning: object) => ({ name: 'getPet', path: '/pets', method: 'GET' as const, callbackDefinition: async () => ({}), ...tuning })

/** Every resource the stack asked for, with the environment that tells two stacks apart taken out. */
const deploy = async (environment: string, args: Partial<LambadaRunArguments>) => {
    const { api } = run('proj', environment, { bundles: () => ({ functionFolder: '.', handler: 'index.main' }), ...args } as LambadaRunArguments)
    await settled(api!.restAPI.body)
    await new Promise(resolve => setTimeout(resolve, 50))
    return JSON.stringify(built.filter(r => r.name.includes(environment)).map(r => ({ type: r.type, name: r.name, inputs: r.inputs })))
        .split(environment).join('ENV')
        // A hash of the API body, which names the environment; the body itself is compared.
        .replace(/"variables":\{"version":"[0-9a-f]+"\}/g, '"variables":{"version":"HASH"}')
}

describe("an endpoint's lambdaOptions", () => {
    test('deploys exactly what its older name, options, deployed', async () => {
        const tuning = { timeout: 33, memorySize: 256, reservedConcurrentExecutions: 2 }
        const older = await deploy('older', { api: { endpointDefinitions: [endpoint({ options: tuning })] } })
        const newer = await deploy('newer', { api: { endpointDefinitions: [endpoint({ lambdaOptions: tuning })] } })

        expect(newer).toContain('"timeout":33')
        expect(newer).toBe(older)
    })

    test('is refused beside options, before anything is built', () => {
        expect(() => run('proj', 'both', {
            api: { endpointDefinitions: [endpoint({ options: { timeout: 1 }, lambdaOptions: { timeout: 2 } })] },
        } as unknown as LambadaRunArguments)).toThrow(/1 invalid declaration[\s\S]*getPet: sets both options and lambdaOptions/)
    })
})

describe('the stack defaults under api, with routes at the root', () => {
    test.each(['', '/api'])('reach every endpoint when apiPath is %p', async apiPath => {
        const stack = await deploy(`root${apiPath.length}`, {
            naming: { apiPath },
            auth: { useApiKey: {} },
            api: { lambdaDefaultOptions: { timeout: 44 }, endpointDefinitions: [endpoint({})] },
        } as unknown as Partial<LambadaRunArguments>)

        expect(stack).toContain('"timeout":44')
        // The method's security in the API body, which requires the key.
        expect(stack).toMatch(/api_key\\+":\[\]/)
    })

    test.each(['', '/api'])('keep cors for the response wrapper when apiPath is %p', apiPath => {
        let context: LambadaResources | undefined
        run('proj', `cors${apiPath.length}`, {
            naming: { apiPath },
            cors: { origins: ['https://app.example.com'], headers: ['authorization'] },
            // Reads the context and builds nothing, so no API and none of its CORS preflight lambdas.
            api: { endpointDefinitions: [(c: LambadaResources) => { context = c; return undefined }] },
        } as unknown as LambadaRunArguments)

        expect(toWrapperConfig({ context: context! }).cors).toEqual({ origins: ['https://app.example.com'], headers: ['authorization'] })
    })
})
