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
