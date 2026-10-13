import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaResource } from '.'

const created: pulumi.runtime.MockResourceArgs[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        created.push(args)
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}` } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const table = (name: string) => ({
    ref: { arn: `arn:table/${name}`, name, streamArn: '' },
    definition: { envKeyName: name.toUpperCase(), indexes: [] },
    streamEnabled: false,
})

const vpcConfig = { subnetIds: ['subnet-a'], securityGroupIds: ['sg-a'] }

const lambda = async (name: string, resources: LambdaResource[]) => {
    const fn = createLambda({ name, environment: 'test', definition: { functionFolder: '.', handler: 'index.main' },
        resources, options: { vpcConfig } }) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)
}

const registered = (type: string, name: string) => created.findIndex(r => r.type === type && r.name === name)

describe('a lambda is created only once its role can do what it grants', () => {
    test('its policy is attached first', async () => {
        await lambda('readNests', [{ table: table('nests') as never, access: ['dynamodb:GetItem'] }])

        const attachment = registered('aws:iam/rolePolicyAttachment:RolePolicyAttachment', 'read-nests-test-policy-attachment')
        expect(attachment).toBeGreaterThanOrEqual(0)
        expect(registered('aws:lambda/function:Function', 'readNests-test')).toBeGreaterThan(attachment)
    })

    test('a lambda sharing the role waits for the same attachment', async () => {
        const eggs = table('eggs')
        await Promise.all([
            lambda('readEggs', [{ table: eggs as never, access: ['dynamodb:GetItem'] }]),
            lambda('countEggs', [{ table: eggs as never, access: ['dynamodb:GetItem'] }]),
        ])

        const attachment = registered('aws:iam/rolePolicyAttachment:RolePolicyAttachment', 'read-eggs-test-policy-attachment')
        expect(attachment).toBeGreaterThanOrEqual(0)
        expect(registered('aws:lambda/function:Function', 'countEggs-test')).toBeGreaterThan(attachment)
    })
})
