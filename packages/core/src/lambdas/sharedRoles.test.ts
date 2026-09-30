import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaResource, sameGrants } from '.'

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

const lambda = async (name: string, resources: LambdaResource[], extra: { statements?: any[], xray?: pulumi.Input<boolean> } = {}) => {
    const fn = createLambda(name, 'test', { functionFolder: '.', handler: 'index.main' }, extra.statements ?? [], {}, resources,
        undefined, { enableXRay: extra.xray }) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)
    return created.find(r => r.type === 'aws:lambda/function:Function' && r.name === `${name}-test`)!.inputs.role as string
}

const rolesNamed = (...names: string[]) =>
    created.filter(r => r.type === 'aws:iam/role:Role' && names.some(n => r.name.startsWith(`${n}-test`))).length

describe('lambdas that grant the same', () => {
    test('share the role of the first, however their access is spelled or ordered', async () => {
        const pets = table('pets')
        const first = await lambda('readPets', [{ table: pets as never, access: ['dynamodb:GetItem', 'dynamodb:Query'] }])
        const second = await lambda('listPets', [{ table: pets as never, access: ['dynamodb:query', 'DynamoDB:GetItem'] }])

        expect(second).toBe(first)
        expect(first).toBe('arn:read-pets-test-role')
        expect(rolesNamed('read-pets', 'list-pets')).toBe(1)
    })
})

describe('lambdas that grant differently keep their own role', () => {
    test('another action', async () => {
        const owners = table('owners')
        const a = await lambda('readOwners', [{ table: owners as never, access: ['dynamodb:GetItem'] }])
        const b = await lambda('writeOwners', [{ table: owners as never, access: ['dynamodb:PutItem'] }])

        expect(b).not.toBe(a)
    })

    test('another resource of the same shape', async () => {
        const a = await lambda('readToys', [{ table: table('toys') as never, access: ['dynamodb:GetItem'] }])
        const b = await lambda('readToysCopy', [{ table: table('toys') as never, access: ['dynamodb:GetItem'] }])

        expect(b).not.toBe(a)
    })

    test('statements passed by the caller, which are known only at deploy', async () => {
        const vets = table('vets')
        const statement = { Effect: 'Allow', Action: ['sns:Publish'], Resource: 'arn:topic' }
        const a = await lambda('readVets', [{ table: vets as never, access: ['dynamodb:GetItem'] }], { statements: [statement] })
        const b = await lambda('readVetsToo', [{ table: vets as never, access: ['dynamodb:GetItem'] }], { statements: [statement] })

        expect(b).not.toBe(a)
    })

    test('X-Ray given as an Output', async () => {
        const walks = table('walks')
        const a = await lambda('readWalks', [{ table: walks as never, access: ['dynamodb:GetItem'] }], { xray: pulumi.output(false) })
        const b = await lambda('readWalksToo', [{ table: walks as never, access: ['dynamodb:GetItem'] }], { xray: pulumi.output(false) })

        expect(b).not.toBe(a)
    })
})

test("a lambda leaves the caller's statements as they were", async () => {
    const statements = [{ Effect: 'Allow', Action: ['sns:Publish'], Resource: 'arn:topic' }]
    await lambda('publishFeeds', [{ table: table('feeds') as never, access: ['dynamodb:GetItem'] }], { statements })

    expect(statements).toHaveLength(1)
})

describe('sameGrants', () => {
    test('hands over the role when the policies agree', () => {
        expect(sameGrants('fn-test', { Version: '2012-10-17', Statement: [] }, { Version: '2012-10-17', Statement: [] }, 'arn:role')).toBe('arn:role')
    })

    test('fails the deploy when they do not', () => {
        const grant = (Resource: string) => ({ Version: '2012-10-17' as const, Statement: [{ Effect: 'Allow' as const, Action: ['sns:publish'], Resource }] })
        expect(() => sameGrants('fn-test', grant('arn:a'), grant('arn:b'), 'arn:role')).toThrow('fn-test shares a role whose policy grants other than its own')
    })
})
