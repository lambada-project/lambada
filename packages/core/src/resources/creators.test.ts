import { describe, expect, test } from 'bun:test'
import { LambadaResources } from '../context'
import { asBuilder, asCreator } from './creators'

const context = { projectName: 'test' } as LambadaResources

describe('asCreator', () => {
    test('wraps a plain object as a creator that ignores the context', () => {
        const args = { name: 'onThing' }

        expect(asCreator(args)(context)).toBe(args)
    })

    test('passes a creator through, still receiving the context', () => {
        expect(asCreator((c: LambadaResources) => c.projectName)(context)).toBe('test')
    })
})

describe('asBuilder', () => {
    const build = (c: LambadaResources, args: { name: string }) => `built ${args.name} in ${c.projectName}`

    test('builds from arguments when handed the plain object', () => {
        expect(asBuilder({ name: 'onThing' }, build)(context)).toBe('built onThing in test')
    })

    test('lets a creator that already built the thing hand it back untouched', () => {
        // A subscription creator subscribes as it goes, so there is nothing left to build.
        expect(asBuilder((c: LambadaResources) => `already built in ${c.projectName}`, build)(context))
            .toBe('already built in test')
    })
})

describe('asCreator and asBuilder agree', () => {
    test('asCreator is asBuilder with a build step that returns its arguments', () => {
        const args = { name: 'onThing' }
        const identity = (_c: LambadaResources, value: typeof args) => value

        expect(asCreator(args)(context)).toBe(asBuilder(args, identity)(context))
    })

    test('the test for a creator lives in one place', () => {
        // asCreator delegates, so there is a single `typeof definition === 'function'` in the source.
        const creator = (c: LambadaResources) => c.projectName

        expect(asCreator(creator)(context)).toBe('test')
        expect(asBuilder(creator, () => 'unused')(context)).toBe('test')
    })
})
