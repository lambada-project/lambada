import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import * as lambdas from '../lambdas'
import { createEndpointSimpleCompat } from './createEndpoint'

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({ id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, url: `https://${args.name}` } }),
    call: () => ({}),
})

// The webhook's queue lambda is lambada's own closure, which bun cannot serialize; what is under test
// is only which authorizers its route carries.
let createLambda: ReturnType<typeof spyOn>
beforeAll(() => { createLambda = spyOn(lambdas, 'createLambda').mockImplementation((() => ({ name: 'stub', arn: 'arn:stub' })) as any) })
afterAll(() => createLambda.mockRestore())

const authorizer = (authorizerName: string) => ({ authorizerName }) as unknown as LambdaAuthorizer
const context = { projectName: 'proj', environment: 'test', authorizers: [authorizer('stackWide')], environmentVariables: {} } as any

const webhook = (auth?: object) => createEndpointSimpleCompat({
    name: 'hook', path: '/hook', method: 'POST', callbackDefinition: async () => ({}),
    webhook: { wrapInQueue: true }, auth,
} as any, context) as unknown as { authorizers: { authorizerName: string }[] }

describe('a webhook in a stack without named authorizers', () => {
    test.each([
        { auth: undefined, expected: ['stackWide'] },
        { auth: { useCognitoAuthorizer: false }, expected: [] },
        { auth: { lambdaAuthorizer: authorizer('own') }, expected: ['own'] },
    ] as { auth?: object, expected: string[] }[])('runs what its endpoint declares: $auth', ({ auth, expected }) => {
        expect(webhook(auth).authorizers.map(a => a.authorizerName)).toEqual(expected)
    })
})
