import { describe, expect, test } from 'bun:test'
import { freezeStack, MOVED_TAG } from './freeze'
import { Pulumi, Result } from './pulumi'

/** A Pulumi Cloud stack at `version`, with the tags it holds. */
const resource = (value: string) => ({ urn: 'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::a', type: 'aws:ssm/parameter:Parameter', id: 'a', custom: true, inputs: { value }, outputs: { value } })
const cloud = (version: number, tags: Record<string, string> = {}, copied = String(version)) => {
    const ok = (stdout: string): Result => ({ code: 0, stdout, stderr: '' })
    const pulumi: Pulumi = (args, { backend }) => {
        if (args[1] === 'export') return ok(JSON.stringify({ deployment: { resources: [resource(backend === 'cloud' ? String(version) : copied)] } }))
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
        expect(freezeStack(c.pulumi, '.', 'petstore/shop/dev', 'dev', now)).toEqual({ state: 'tagged', version: 7 })
        expect(c.tags).toEqual({ [MOVED_TAG]: 'version 7 at 2026-10-30T12:00:00.000Z' })
    })

    test('again: unchanged, or the deploy that landed since', () => {
        const tags = { [MOVED_TAG]: 'version 7 at 2026-10-30T12:00:00.000Z' }
        expect(freezeStack(cloud(7, { ...tags }).pulumi, '.', 'petstore/shop/dev', 'dev')).toEqual({ state: 'unchanged', version: 7, at: '2026-10-30T12:00:00.000Z' })
        expect(freezeStack(cloud(9, { ...tags }).pulumi, '.', 'petstore/shop/dev', 'dev')).toEqual({ state: 'deployed', version: 7, at: '2026-10-30T12:00:00.000Z', now: 9 })
    })

    test('a deploy between the copy and the freeze is refused, not tagged', () => {
        const c = cloud(8, {}, '7')
        expect(() => freezeStack(c.pulumi, '.', 'petstore/shop/dev', 'dev', now)).toThrow('was deployed after the copy')
        expect(c.tags).toEqual({})
    })

    test('a tag it did not write is refused', () => {
        expect(() => freezeStack(cloud(7, { [MOVED_TAG]: 'yes' }).pulumi, '.', 'petstore/shop/dev', 'dev')).toThrow('which is not `version <n> at <time>`')
    })
})
