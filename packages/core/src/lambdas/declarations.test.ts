import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments, run } from '..'

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
