import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaOptions } from '.'

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

type Statement = { Effect: string, Action: string[], Resource: string | string[], Condition?: unknown }

let lambdas = 0

/** The statements of the policy createLambda gives a lambda built with these options. */
const statementsFor = async (options: LambdaOptions) => {
    const name = `exec${lambdas++}`
    const table = { ref: { arn: `arn:table/${name}`, name, streamArn: '' }, definition: { envKeyName: 'T', indexes: [] }, streamEnabled: false }
    const fn = createLambda(name, 'test', { functionFolder: '.', handler: 'index.main' }, [], {},
        [{ table: table as never, access: ['dynamodb:GetItem'] }], undefined, options) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)

    const policy = created.find(r => r.type === 'aws:iam/policy:Policy' && r.name === `${name}-test-policy`)!.inputs.policy
    return (typeof policy === 'string' ? JSON.parse(policy) : policy).Statement as Statement[]
}

const ec2 = (statements: Statement[]) => statements.filter(s => s.Action.some(a => a.startsWith('ec2:')))

const vpcConfig = { subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] }

describe('a lambda in a VPC', () => {
    test('allows Lambda the network interface actions AWS requires, on every resource', async () => {
        const [allow] = ec2(await statementsFor({ vpcConfig })).filter(s => s.Effect === 'Allow')

        expect(allow.Action.sort()).toEqual([
            'ec2:assignprivateipaddresses', 'ec2:createnetworkinterface', 'ec2:deletenetworkinterface',
            'ec2:describenetworkinterfaces', 'ec2:describesubnets', 'ec2:unassignprivateipaddresses',
        ])
        expect(allow.Resource).toBe('*')
    })

    test("denies those actions to the function's own code", async () => {
        const [deny] = ec2(await statementsFor({ vpcConfig })).filter(s => s.Effect === 'Deny')

        expect(deny.Action).toEqual(expect.arrayContaining(ec2(await statementsFor({ vpcConfig })).find(s => s.Effect === 'Allow')!.Action))
        expect(deny.Condition).toEqual({ Null: { 'lambda:SourceFunctionArn': 'false' } })
    })

    test('is the only lambda that gets them', async () => {
        expect(ec2(await statementsFor({}))).toEqual([])
    })
})

test('X-Ray is on every resource, as IAM takes no resource for its actions', async () => {
    const xray = (await statementsFor({ enableXRay: true })).find(s => s.Action.some(a => a.startsWith('xray:')))!

    expect(xray.Resource).toBe('*')
})
