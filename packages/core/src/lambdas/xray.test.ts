import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createLambda } from '.'

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

let lambdas = 0

/** The actions in the policy createLambda gives a lambda built with this flag. */
const actionsFor = async (enableXRay: pulumi.Input<boolean> | undefined) => {
    const name = `xray${lambdas++}`
    const table = { ref: { arn: `arn:table/${name}`, name, streamArn: '' }, definition: { envKeyName: 'T', indexes: [] }, streamEnabled: false }
    const fn = createLambda({ name, environment: 'test', definition: { functionFolder: '.', handler: 'index.main' },
        resources: [{ table: table as never, access: ['dynamodb:GetItem'] }], options: { enableXRay } }) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)

    const policy = created.find(r => r.type === 'aws:iam/policy:Policy' && r.name === `${name}-test-policy`)!.inputs.policy
    const document = typeof policy === 'string' ? JSON.parse(policy) : policy
    return document.Statement.flatMap((s: { Action: string[] }) => s.Action) as string[]
}

describe('a lambda gets the X-Ray statement only when its flag is true', () => {
    test.each([
        ['a plain false', false as pulumi.Input<boolean>, false],
        ['a plain true', true as pulumi.Input<boolean>, true],
        ['an Output false', pulumi.output(false), false],
        ['an Output true', pulumi.output(true), true],
        ['a promised false', Promise.resolve(false), false],
    ] as [string, pulumi.Input<boolean>, boolean][])('%s', async (_name, flag, granted) => {
        expect((await actionsFor(flag)).includes('xray:puttracesegments')).toBe(granted)
    })

    test('not set at all', async () => {
        expect(await actionsFor(undefined)).not.toContain('xray:puttracesegments')
    })
})
