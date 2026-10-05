import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { mergeOptions } from '../api/createEndpoint'
import { createLambda, LambdaOptions } from '../lambdas'

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

const stackOptions = { logGroupPrefix: '/lambada/pets' }

const built = async (name: string, options: LambdaOptions) => {
    const fn = createLambda(name, 'test', { functionFolder: '.', handler: 'index.main' }, [], {}, [], undefined, options) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)
    return {
        fn: created.find(r => r.type === 'aws:lambda/function:Function' && r.name === `${name}-test`)!.inputs,
        group: created.find(r => r.type === 'aws:cloudwatch/logGroup:LogGroup' && r.name === `${name}-test-logs`)?.inputs,
    }
}

describe('a lambda whose stack gives a log group prefix', () => {
    test('logs to a log group of its own under it, which never expires unless asked', async () => {
        const { fn, group } = await built('getPet', mergeOptions(undefined, stackOptions))

        expect(group).toMatchObject({ name: '/lambada/pets/getPet-test' })
        expect(group!.retentionInDays).toBeUndefined()
        expect(fn.loggingConfig).toEqual({ logFormat: 'Text', logGroup: '/lambada/pets/getPet-test' })
    })

    test("keeps logs as long as its own options say, over the stack's", async () => {
        const { group } = await built('listPets', mergeOptions({ logRetention: { days: 14 } }, { ...stackOptions, logRetention: { days: 90 } }))

        expect(group!.retentionInDays).toBe(14)
    })

    test("keeps logs as long as the stack's options say, when its own say nothing", async () => {
        const { group } = await built('sweep', mergeOptions({}, { ...stackOptions, logRetention: { days: 90 } }))

        expect(group!.retentionInDays).toBe(90)
    })
})

test('a lambda without a log group prefix keeps the log group Lambda gives it', async () => {
    const { fn, group } = await built('lone', {})

    expect(group).toBeUndefined()
    expect(fn.loggingConfig).toBeUndefined()
})
