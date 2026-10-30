import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backStack, cloudSettings } from './back'
import { MOVED_TAG } from './freeze'
import { Pulumi, Result } from './pulumi'
import { Config } from './state'

const TARGET_SETTINGS = `secretsprovider: awskms://alias/state?region=us-east-1
encryptedkey: AQICAHh
config:
  shop:key:
    secure: v1:abc
  shop:sizes:
    - 1
    - 2
environment:
  - shop/dev
`

describe('the settings file for Pulumi Cloud', () => {
    test('loses the target encryption and config, and keeps the rest', () => {
        expect(cloudSettings(TARGET_SETTINGS)).toBe('environment:\n  - shop/dev\n')
        expect(cloudSettings('config: {}\n')).toBe('')
    })
})

const resource = (value: string) => ({ urn: 'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::a', type: 'aws:ssm/parameter:Parameter', id: 'a', custom: true, inputs: { value }, outputs: { value } })
const state = (value: string, provider = 'service') => ({ deployment: { resources: [resource(value)], secrets_providers: { type: provider } } })

/** A Pulumi Cloud stack tagged as moved at version 7, and the target that deployed since. */
const fake = (options: { cloudVersion?: number, tags?: Record<string, string>, provider?: string, config?: Config, deployDuringRead?: boolean } = {}) => {
    const calls: { call: string, input?: string }[] = []
    const tags = options.tags ?? { [MOVED_TAG]: 'version 7 at 2026-10-30T12:00:00.000Z' }
    let cloudVersion = options.cloudVersion ?? 7
    let cloudState: object = state('7', options.provider)
    let targetExports = 0
    const targetConfig: Config = options.config ?? { 'shop:key': { value: 's3cret', secret: true }, 'shop:n': { value: '2' } }
    let cloudConfig: Config = {}
    const ok = (stdout: string): Result => ({ code: 0, stdout, stderr: '' })
    const pulumi: Pulumi = (args, { backend, input }) => {
        const call = `${backend} ${args.join(' ')}`
        calls.push({ call, input })
        const cloud = backend === 'cloud'
        if (args[1] === 'tag' && args[2] === 'ls') return ok(JSON.stringify(tags))
        if (args[1] === 'tag' && args[2] === 'rm') { delete tags[args[3]]; return ok('') }
        if (args[1] === 'history') return ok(JSON.stringify([{ version: cloud ? cloudVersion : 0 }]))
        if (args[1] === 'export' && !cloud) return ok(JSON.stringify(state(options.deployDuringRead && targetExports++ > 0 ? '4' : '3', 'awskms')))
        if (args[1] === 'export') return ok(JSON.stringify(cloudState))
        if (args[1] === 'import') { cloudVersion++; cloudState = state('3'); return ok('') }
        if (args[0] === 'config' && args[1] === 'set-all') { cloudConfig = { ...cloudConfig, ...JSON.parse(args[3]) }; return ok('') }
        if (args[0] === 'config' && args[1] === 'set') { cloudConfig[args[2]] = { value: input, secret: true }; return ok('') }
        if (args[0] === 'config') return ok(JSON.stringify(cloud ? cloudConfig : targetConfig))
        throw new Error(`unexpected ${call}`)
    }
    return { pulumi, calls, tags }
}

const project = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'back-test-'))
    writeFileSync(join(cwd, 'Pulumi.dev.yaml'), TARGET_SETTINGS)
    return cwd
}
const back = (pulumi: Pulumi, cwd = project()) => backStack({ pulumi, cwd, source: 'petstore/shop/dev', stack: 'dev', log: () => {} })
const writes = (calls: { call: string }[]) => calls.filter(c => /^cloud (config set|stack import|stack tag rm)/.test(c.call))

describe('going back to Pulumi Cloud', () => {
    test('imports the target state and config, proves them, and untags the stack', () => {
        const f = fake()
        const cwd = project()
        expect(back(f.pulumi, cwd)).toEqual({ version: 8 })
        expect(f.tags).toEqual({})
        expect(readFileSync(join(cwd, 'Pulumi.dev.yaml'), 'utf8')).toBe('environment:\n  - shop/dev\n')
        const secret = f.calls.find(c => c.call.startsWith('cloud config set shop:key'))
        expect(secret).toEqual({ call: 'cloud config set shop:key --secret --raw -s petstore/shop/dev', input: 's3cret' })
        expect(f.calls.some(c => c.call.includes('s3cret'))).toBe(false)
    })

    test('a Pulumi Cloud deploy after the move is refused before anything changes', () => {
        const f = fake({ cloudVersion: 8 })
        const cwd = project()
        expect(() => back(f.pulumi, cwd)).toThrow('Both backends have deployed')
        expect(writes(f.calls)).toEqual([])
        expect(readFileSync(join(cwd, 'Pulumi.dev.yaml'), 'utf8')).toBe(TARGET_SETTINGS)
    })

    test('a stack never frozen is refused', () => {
        const f = fake({ tags: {} })
        expect(() => back(f.pulumi)).toThrow(`has no ${MOVED_TAG} tag`)
        expect(writes(f.calls)).toEqual([])
    })

    test('a target deploy while it is read is refused before anything changes', () => {
        const f = fake({ deployDuringRead: true })
        const cwd = project()
        expect(() => back(f.pulumi, cwd)).toThrow('dev was deployed while being read')
        expect(writes(f.calls)).toEqual([])
        expect(readFileSync(join(cwd, 'Pulumi.dev.yaml'), 'utf8')).toBe(TARGET_SETTINGS)
    })

    test('a stack Pulumi Cloud did not encrypt, or a structured secret, is left to a person', () => {
        expect(() => back(fake({ provider: 'passphrase' }).pulumi)).toThrow('encrypts with passphrase')
        const f = fake({ config: { 'shop:db': { value: '{"password":"x"}', objectValue: { password: 'x' }, secret: true } as Config[string] } })
        expect(() => back(f.pulumi)).toThrow('shop:db: a secret holding a map or list')
        expect(writes(f.calls)).toEqual([])
    })
})
