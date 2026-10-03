import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createLogGroups } from '.'
import { mergeOptions } from '../api/createEndpoint'
import { createLambda } from '../lambdas'

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

const logGroups = createLogGroups('test', { api: { name: 'api', retention: { days: 14 } }, jobs: { name: 'jobs' } })

const functionArgs = async (name: string, options: Parameters<typeof createLambda>[7]) => {
    const fn = createLambda(name, 'test', { functionFolder: '.', handler: 'index.main' }, [], {}, [], undefined, options) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)
    return created.find(r => r.type === 'aws:lambda/function:Function' && r.name === `${name}-test`)!.inputs
}

describe('a log group of the stack', () => {
    test('is named under /lambada and keeps logs for its retention', async () => {
        expect(await settled(logGroups.api.awsLogGroup.name)).toBe('/lambada/api-test')
        expect(created.find(r => r.name === 'api-test' && r.type === 'aws:cloudwatch/logGroup:LogGroup')!.inputs.retentionInDays).toBe(14)
    })
})

describe('a lambda', () => {
    test('logs to its default log group when no options name one', async () => {
        expect((await functionArgs('plain', mergeOptions(undefined, undefined, { functionName: 'plain', logGroups }))).loggingConfig).toBeUndefined()
    })

    test('logs to the group its options name', async () => {
        const args = await functionArgs('getPet', mergeOptions({ logGroup: 'api' }, undefined, { functionName: 'getPet', logGroups }))

        expect(args.loggingConfig).toEqual({ logFormat: 'Text', logGroup: '/lambada/api-test' })
    })

    test("takes the stack's log group when its own options name none", async () => {
        const args = await functionArgs('sweep', mergeOptions({}, { logGroup: 'jobs' }, { functionName: 'sweep', logGroups }))

        expect(args.loggingConfig.logGroup).toBe('/lambada/jobs-test')
    })

    test("keeps its own log group over the stack's", async () => {
        const args = await functionArgs('report', mergeOptions({ logGroup: 'api' }, { logGroup: 'jobs' }, { functionName: 'report', logGroups }))

        expect(args.loggingConfig.logGroup).toBe('/lambada/api-test')
    })

    test('naming a log group the stack lacks is refused, with the function that asked', () => {
        expect(() => mergeOptions({ logGroup: 'apii' }, undefined, { functionName: 'getPet', logGroups }))
            .toThrow("getPet needs logGroup 'apii', which is absent from the stack. The stack has: api, jobs.")
    })

    test('naming a log group outside a stack is refused', () => {
        expect(() => createLambda('lone', 'test', { functionFolder: '.', handler: 'index.main' }, [], {}, [], undefined, { logGroup: 'api' }))
            .toThrow("lone names the log group 'api'")
    })
})
