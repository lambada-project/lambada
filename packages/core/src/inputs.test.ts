import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { lift, lift2 } from './inputs'

const resolved = <T>(output: pulumi.Output<T>) => new Promise<T>(done => output.apply(done))

describe('lift', () => {
    test('maps a plain value', async () => {
        expect(await resolved(lift(2, n => n * 3))).toBe(6)
    })

    test('maps a promise', async () => {
        expect(await resolved(lift(Promise.resolve(2), n => n * 3))).toBe(6)
    })

    test('maps an output', async () => {
        expect(await resolved(lift(pulumi.output(2), n => n * 3))).toBe(6)
    })

    test('flattens a mapper that returns a promise', async () => {
        expect(await resolved(lift(2, async n => n * 3))).toBe(6)
    })

    test('flattens a mapper that returns an output', async () => {
        expect(await resolved(lift(2, n => pulumi.output(n * 3)))).toBe(6)
    })

    test('is an Output whatever it was given, which is the whole point', () => {
        // A lift that returned the bare value for a bare input would put an object into a
        // synchronous position for the other two, where it is merely truthy.
        for (const input of [false, Promise.resolve(false), pulumi.output(false)]) {
            expect(pulumi.Output.isInstance(lift(input, x => x))).toBe(true)
        }
    })

    test('a falsy value stays falsy through the lift, not truthy as its wrapper was', async () => {
        // The bug this replaced: `Input<boolean>` tested directly is an object, so false read true.
        expect(await resolved(lift(pulumi.output(false), isFifo => (isFifo ? '.fifo' : '')))).toBe('')
        expect(await resolved(lift(undefined as boolean | undefined, isFifo => (isFifo ? '.fifo' : '')))).toBe('')
        expect(await resolved(lift(pulumi.output(true), isFifo => (isFifo ? '.fifo' : '')))).toBe('.fifo')
    })
})

describe('lift2', () => {
    test('resolves both before mapping, whatever shape each arrived in', async () => {
        expect(await resolved(lift2(pulumi.output('a'), Promise.resolve('b'), (x, y) => x + y))).toBe('ab')
    })
})
