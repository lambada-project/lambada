import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { lift } from '../inputs'

const value = <T>(output: pulumi.Output<T>): Promise<T> =>
    (output as unknown as { promise(): Promise<T> }).promise()

/** What createLambda does with `options.enableXRay`, which is a `pulumi.Input<boolean>`. */
const gate = (enableXRay: pulumi.Input<boolean> | undefined, statements: string[]) =>
    lift(enableXRay ?? false, enabled => (enabled ? [...statements, 'xray'] : statements))

describe('gating a policy statement on an Input flag', () => {
    test.each([
        ['a plain false', false as pulumi.Input<boolean>, ['logs']],
        ['a plain true', true as pulumi.Input<boolean>, ['logs', 'xray']],
        ['an Output false', pulumi.output(false), ['logs']],
        ['an Output true', pulumi.output(true), ['logs', 'xray']],
        ['a promised false', Promise.resolve(false), ['logs']],
    ] as [string, pulumi.Input<boolean>, string[]][])('%s', async (_name, flag, expected) => {
        expect(await value(gate(flag, ['logs']))).toEqual(expected)
    })

    test('omits it when the flag is not set at all', async () => {
        expect(await value(gate(undefined, ['logs']))).toEqual(['logs'])
    })
})
