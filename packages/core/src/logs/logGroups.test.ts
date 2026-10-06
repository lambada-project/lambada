import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { mergeOptions } from '../api/createEndpoint'
import { createLambda, LambdaOptions } from '../lambdas'
import { LogsResult } from '.'

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

const built = async (name: string, options: LambdaOptions, logs?: LogsResult) => {
    const fn = createLambda({ name, environment: 'test', definition: { functionFolder: '.', handler: 'index.main' }, options, logs }) as unknown as { arn: pulumi.Output<string> }
    await settled(fn.arn)
    return {
        fn: created.find(r => r.type === 'aws:lambda/function:Function' && r.name === `${name}-test`)!.inputs,
        group: created.find(r => r.type === 'aws:cloudwatch/logGroup:LogGroup' && r.name === `${name}-test-logs`)?.inputs,
    }
}

describe('a lambda of a stack that declares logs', () => {
    const logs = { prefix: '/lambada/pets' }

    test('logs to a log group of its own under the project, which never expires unless asked', async () => {
        const { fn, group } = await built('getPet', {}, logs)

        expect(group).toMatchObject({ name: '/lambada/pets/getPet-test' })
        expect(group!.retentionInDays).toBeUndefined()
        expect(fn.loggingConfig).toEqual({ logFormat: 'Text', logGroup: '/lambada/pets/getPet-test' })
    })

    test("keeps logs as long as the stack's logs say", async () => {
        const { group } = await built('sweep', {}, { ...logs, retention: { days: 90 } })

        expect(group!.retentionInDays).toBe(90)
    })

    test("keeps logs as long as its own options say, over the stack's", async () => {
        const { group } = await built('listPets', mergeOptions({ logRetention: { days: 14 } }, {}), { ...logs, retention: { days: 90 } })

        expect(group!.retentionInDays).toBe(14)
    })
})

test('a lambda of a stack that declares no logs keeps the log group Lambda gives it, whatever its retention', async () => {
    const { fn, group } = await built('lone', { logRetention: { days: 14 } })

    expect(group).toBeUndefined()
    expect(fn.loggingConfig).toBeUndefined()
})
