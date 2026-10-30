import { describe, expect, test } from 'bun:test'
import { freezeStack, MOVED_TAG } from './freeze'
import { Pulumi, Result } from './pulumi'

/** A Pulumi Cloud stack at `version`, with the tags it holds. */
const cloud = (version: number, tags: Record<string, string> = {}) => {
    const ok = (stdout: string): Result => ({ code: 0, stdout, stderr: '' })
    const pulumi: Pulumi = (args, { backend }) => {
        expect(backend).toBe('cloud')
        if (args[1] === 'history') return ok(JSON.stringify([{ version }]))
        if (args[1] === 'tag' && args[2] === 'ls') return ok(JSON.stringify(tags))
        if (args[1] === 'tag' && args[2] === 'set') { tags[args[3]] = args[4]; return ok('') }
        throw new Error(`unexpected ${args.join(' ')}`)
    }
    return { pulumi, tags }
}

describe('freezing a Pulumi Cloud stack', () => {
    const now = new Date('2026-10-30T12:00:00.000Z')

    test('records the version it moved at, and deletes nothing', () => {
        const c = cloud(7)
        expect(freezeStack(c.pulumi, '.', 'petstore/shop/dev', now)).toEqual({ state: 'tagged', version: 7 })
        expect(c.tags).toEqual({ [MOVED_TAG]: 'version 7 at 2026-10-30T12:00:00.000Z' })
    })

    test('again: unchanged, or the deploy that landed since', () => {
        const tags = { [MOVED_TAG]: 'version 7 at 2026-10-30T12:00:00.000Z' }
        expect(freezeStack(cloud(7, { ...tags }).pulumi, '.', 'petstore/shop/dev')).toEqual({ state: 'unchanged', version: 7, at: '2026-10-30T12:00:00.000Z' })
        expect(freezeStack(cloud(9, { ...tags }).pulumi, '.', 'petstore/shop/dev')).toEqual({ state: 'deployed', version: 7, at: '2026-10-30T12:00:00.000Z', now: 9 })
    })

    test('a tag it did not write is refused', () => {
        expect(() => freezeStack(cloud(7, { [MOVED_TAG]: 'yes' }).pulumi, '.', 'petstore/shop/dev')).toThrow('which is not `version <n> at <time>`')
    })
})
