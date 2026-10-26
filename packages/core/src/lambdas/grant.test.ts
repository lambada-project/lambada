import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { grant, LambadaRunArguments, run } from '..'

const built: { name: string, type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, inputs: args.inputs })
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, name: args.inputs.name ?? args.name } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const pets = { name: 'pets-test', arn: 'arn:aws:dynamodb:us-east-1:123456789012:table/pets-test', streamArn: '', kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/pets' }

const usersRoutes = ['arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4e5/app/GET/api/users/*']

const stack = (environment: string, functions: object[] = []) => run('proj', environment, {
    bundles: () => ({ functionFolder: '.', handler: 'index.main' }),
    customRef: { users: { service: 'execute-api', resources: usersRoutes } },
    tablesRef: { pets: { awsTable: {}, ref: pets, definition: { name: 'pets', primaryKey: 'id', envKeyName: 'PETS_TABLE_NAME' }, streamEnabled: false } },
    scheduleDefinitions: functions,
} as unknown as LambadaRunArguments)

const settle = () => new Promise(resolve => setTimeout(resolve, 50))
const documentOf = (type: string, name: string) => {
    const policy = built.find(r => r.type === type && r.name === name)!.inputs.policy
    return typeof policy === 'string' ? JSON.parse(policy) : policy
}

describe('grant', () => {
    test("gives a role the policy a lambada function declaring the same resources gets", async () => {
        const resources = { table: { pets: ['dynamodb:GetItem'] } }
        stack('own', [{ name: 'readPets', schedule: { every: { minutes: 5 } }, callback: { functionFolder: '.', handler: 'index.main' }, resources }])
        const role = new aws.iam.Role('external-role', { assumeRolePolicy: '{}' })
        const policy = grant(stack('external'), role, 'readPets', resources as never)
        await settled(policy.policy)
        await settle()

        const own = documentOf('aws:iam/policy:Policy', 'read-pets-own-policy')
        const granted = documentOf('aws:iam/rolePolicy:RolePolicy', 'readPets-grants')
        expect(granted).toEqual(own)
        expect(JSON.stringify(granted)).toContain('kms:')
        expect(built.find(r => r.name === 'readPets-grants')!.inputs.role).toBe('external-role')
    })

    test('gives a role a custom grant on exactly its resources', async () => {
        const policy = grant(stack('custom'), new aws.iam.Role('custom-role', { assumeRolePolicy: '{}' }), 'callUsers', { custom: { users: ['execute-api:Invoke'] } })
        await settled(policy.policy)
        await settle()

        expect(documentOf('aws:iam/rolePolicy:RolePolicy', 'callUsers-grants').Statement)
            .toContainEqual({ Effect: 'Allow', Action: ['execute-api:invoke'], Resource: usersRoutes[0] })
    })

    test('refuses a custom grant of another service', () => {
        expect(() => grant(stack('foreign'), new aws.iam.Role('foreign-role', { assumeRolePolicy: '{}' }), 'callUsers', { custom: { users: ['s3:GetObject'] } }))
            .toThrow("callUsers: grants custom 'users' s3:GetObject, outside its service 'execute-api'.")
    })

    test('refuses a name the stack does not hold', () => {
        expect(() => grant(stack('missing'), new aws.iam.Role('missing-role', { assumeRolePolicy: '{}' }), 'reader', { table: { pet: ['dynamodb:GetItem'] } } as never))
            .toThrow('pet')
    })

    test('refuses an envVar grant, which belongs to whoever builds the function', () => {
        expect(() => grant(stack('vars'), new aws.iam.Role('vars-role', { assumeRolePolicy: '{}' }), 'reader', { envVar: ['A'] } as never))
            .toThrow('IAM only')
    })
})
