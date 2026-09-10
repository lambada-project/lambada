import { describe, expect, test } from 'bun:test'
import { bundleOf, isLambdaFolder } from './bundles'
import { LambdaFolder } from '.'

const artifact = (name: string): LambdaFolder => ({ functionFolder: `dist/bundles/${name}`, handler: 'index.handler' })

const manifest = { getPet: artifact('getPet'), markReady: artifact('markReady') }

describe('bundleOf', () => {
    test('finds the artifact named for a function in a manifest', () => {
        expect(bundleOf(manifest, 'getPet')).toEqual(artifact('getPet'))
    })

    test('finds it through a lookup, which is what a reader of the manifest hands over', () => {
        const lookup = (name: string) => manifest[name as keyof typeof manifest]

        expect(bundleOf(lookup, 'markReady')).toEqual(artifact('markReady'))
    })

    test('is undefined for a function the build produced nothing for, so it keeps its closure', () => {
        expect(bundleOf(manifest, 'health')).toBeUndefined()
        expect(bundleOf((name) => manifest[name as keyof typeof manifest], 'health')).toBeUndefined()
    })

    test('is undefined when the stack was given no bundles at all', () => {
        expect(bundleOf(undefined, 'getPet')).toBeUndefined()
    })

    test('is undefined for a function with no name, which cannot be looked up', () => {
        expect(bundleOf(manifest, undefined)).toBeUndefined()
    })
})

describe('isLambdaFolder', () => {
    test('tells an artifact from a callback, which is how an explicit one is honoured', () => {
        expect(isLambdaFolder(artifact('getPet'))).toBe(true)
        expect(isLambdaFolder(async () => {})).toBe(false)
        expect(isLambdaFolder(undefined)).toBe(false)
        expect(isLambdaFolder(null)).toBe(false)
        expect(isLambdaFolder({ handler: 'index.handler' })).toBe(false)
    })
})

describe('what a manifest entry does not reach', () => {
    // The glue is named for the handler, and nothing builds an artifact shaped like it.
    test('nothing is keyed for the lambda behind a webhook queue', () => {
        const folder = { functionFolder: './dist/postHook', handler: 'index.handler' }

        expect(bundleOf({ postHook: folder }, 'postHook-handler')).toBeUndefined()
    })
})
