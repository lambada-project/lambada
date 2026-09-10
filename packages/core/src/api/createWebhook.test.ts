import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { requireVisibilityCoversTimeout, visibilityTimeoutFor } from './createWebhook'

const value = <T>(output: pulumi.Output<T>): Promise<T> =>
    (output as unknown as { promise(): Promise<T> }).promise()

describe('requireVisibilityCoversTimeout', () => {
    test('keeps a visibility timeout that covers the handler', () => {
        expect(requireVisibilityCoversTimeout(60, 30)).toBe(60)
    })

    test('accepts them being equal, the handler finishing exactly in time', () => {
        expect(requireVisibilityCoversTimeout(30, 30)).toBe(30)
    })

    test('defaults both to 30 when neither is given', () => {
        expect(requireVisibilityCoversTimeout(undefined, undefined)).toBe(30)
    })

    test('refuses a queue that uncovers the message before the handler is done', () => {
        expect(() => requireVisibilityCoversTimeout(10, 30)).toThrow(
            /visibilityTimeoutSeconds \(10\) must be greater or equal than the endpoint's timeout \(30\)/,
        )
    })
})

describe('visibilityTimeoutFor', () => {
    test('applies the rule to values that arrive as Outputs', async () => {
        // The check this replaced compared an Input as a number, which is always false, so a
        // misconfigured pair passed silently and every message could be processed twice.
        expect(await value(visibilityTimeoutFor(pulumi.output(60), pulumi.output(30)))).toBe(60)
    })

    test('is an Output the queue is built from, so the check cannot go unread', () => {
        expect(pulumi.Output.isInstance(visibilityTimeoutFor(60, 30))).toBe(true)
    })
})
