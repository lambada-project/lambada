import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments, run } from '..'

const functions: { name: string, variables: Record<string, string> }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        if (args.type === 'aws:lambda/function:Function') functions.push({ name: args.name, variables: args.inputs.environment?.variables ?? {} })
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, invokeArn: `invoke:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

describe('a function granted a pool entry by its registry name', () => {
    test('reads it under its envKeyName', async () => {
        const { api } = run('proj', 'keys', {
            bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
            environmentVariables: {
                pageSize: { envKeyName: 'PAGE_SIZE', value: '20' },
                cacheTtl: { envKeyName: 'CACHE_TTL', value: pulumi.output('30') },
            },
            api: {
                endpointDefinitions: [{
                    name: 'listPets', path: '/pets', method: 'GET', callbackDefinition: async () => ({}),
                    resources: { envVar: ['pageSize', 'cacheTtl'] },
                }],
            },
        } as unknown as LambadaRunArguments)
        await settled(api!.restAPI.body)
        await new Promise(resolve => setTimeout(resolve, 50))

        const listPets = functions.find(f => f.name.startsWith('listPets-keys'))!
        expect(listPets.variables).toMatchObject({ PAGE_SIZE: '20', CACHE_TTL: '30' })
        expect(Object.keys(listPets.variables)).not.toContain('pageSize')
    })

    test('is reported before anything is built when granted by its envKeyName instead', () => {
        expect(() => run('proj', 'strict', {
            environmentVariables: { pageSize: { envKeyName: 'PAGE_SIZE', value: '20' } },
            api: {
                endpointDefinitions: [{
                    name: 'listPets', path: '/pets', method: 'GET', callbackDefinition: async () => ({}),
                    resources: { envVar: ['PAGE_SIZE'] },
                }],
            },
        } as unknown as LambadaRunArguments)).toThrow(/granted but absent[\s\S]*listPets\s+environment variable 'PAGE_SIZE' — the stack has: pageSize/)
    })

    test('a pool giving one variable two values is refused before anything is built', () => {
        expect(() => run('proj', 'twice', {
            environmentVariables: { cacheTtl: { envKeyName: 'CACHE_TTL', value: '1' }, legacyCacheTtl: { envKeyName: 'CACHE_TTL', value: '2' } },
        } as unknown as LambadaRunArguments)).toThrow('cacheTtl, legacyCacheTtl all set CACHE_TTL')
    })
})
