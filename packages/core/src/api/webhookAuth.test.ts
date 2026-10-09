import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambdaAuthorizer } from '@pulumi/awsx/classic/apigateway'
import * as lambdas from '../lambdas'
import { createEndpointSimpleCompat } from './createEndpoint'
import { webhookOptions } from './createWebhook'

const queues: { name: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        if (args.type === 'aws:sqs/queue:Queue') queues.push({ name: args.name, inputs: args.inputs })
        return { id: `${args.name}-id`, state: { ...args.inputs, arn: `arn:${args.name}`, url: `https://${args.name}` } }
    },
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

describe("a webhook's function options", () => {
    const tuned = (name: string, tuning: object, webhookOptions?: object) => {
        createLambda.mockClear()
        createEndpointSimpleCompat({
            name, path: `/${name}`, method: 'POST', callbackDefinition: async () => ({}),
            webhook: { wrapInQueue: true, options: webhookOptions }, ...tuning,
        } as any, context)
        return createLambda.mock.calls.map(([args]: any) => ({ name: args.name, timeout: args.options?.timeout }))
    }
    const queue = async (name: string) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return queues.find(q => q.name === `${name}-test`)?.inputs
    }

    test.each([
        { name: 'newer', tuning: { lambdaOptions: { timeout: 20 } } },
        { name: 'older', tuning: { options: { timeout: 20 } } },
    ])('$tuning reaches its queue handler and its ingress', async ({ name, tuning }) => {
        expect(tuned(name, tuning, { visibilityTimeoutSeconds: 45 })).toEqual([
            { name: `${name}-handler`, timeout: 20 },
            { name: `${name}-webhook`, timeout: 20 },
        ])
        expect((await queue(name)).visibilityTimeoutSeconds).toBe(45)
    })

    test('a queue that uncovers the message before the timeout is refused', async () => {
        // The handlers above and this check read one resolved timeout. Through createWebhook the refusal
        // would surface inside the queue's own registration, which no promise here can hold.
        const { queueOptions } = webhookOptions({ lambdaOptions: { timeout: 20 }, webhook: { options: { visibilityTimeoutSeconds: 10 } } })
        const visibility = queueOptions.visibilityTimeoutSeconds as unknown as Record<'isKnown' | 'isSecret', Promise<boolean>> & { promise(): Promise<number> }
        // An Output rejects through its known and secret flags as well as its value.
        visibility.isKnown.catch(() => undefined)
        visibility.isSecret.catch(() => undefined)

        await expect(visibility.promise())
            .rejects.toThrow("visibilityTimeoutSeconds (10) must be greater or equal than the endpoint's timeout (20)")
    })

    test("leaves the caller's options as they were", () => {
        const shared = { memorySize: 256 }
        const queueArgs = { delaySeconds: 3 }
        tuned('sharing', { lambdaOptions: shared }, queueArgs)

        expect(shared).toEqual({ memorySize: 256 })
        expect(queueArgs).toEqual({ delaySeconds: 3 })
    })

    test('are refused beside options', () => {
        expect(() => createEndpointSimpleCompat({
            name: 'both', path: '/both', method: 'POST', callbackDefinition: async () => ({}),
            webhook: { wrapInQueue: true }, options: { timeout: 1 }, lambdaOptions: { timeout: 2 },
        } as any, context)).toThrow('both: sets both options and lambdaOptions')
    })
})
