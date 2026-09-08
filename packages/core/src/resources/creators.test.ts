import { describe, expect, test } from 'bun:test'
import { LambadaResources } from '../context'
import { asCreator } from './creators'

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
