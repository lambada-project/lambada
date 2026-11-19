import { describe, expect, test } from 'bun:test'
import { migrateStack } from './migrate'
import { Pulumi, Result } from './pulumi'
import { configDifferences, stateDifferences } from './state'

const resource = (name: string, value: string) => ({ urn: `urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::${name}`, type: 'aws:ssm/parameter:Parameter', id: name, custom: true, inputs: { value }, outputs: { value } })
const exported = (resources: { urn: string }[], pending: object[] = []) => ({ deployment: { resources, pending_operations: pending } })

describe('two exports of one stack', () => {
    test('equal apart from the backend', () => {
        const a = { deployment: { ...exported([resource('a', '1')]).deployment, secrets_providers: { type: 'service' } } }
        const b = { deployment: { ...exported([resource('a', '1')]).deployment, secrets_providers: { type: 'passphrase' } } }
        expect(stateDifferences(a, b)).toEqual([])
    })
    test('a changed, missing or extra resource, and an interrupted source', () => {
        expect(stateDifferences(exported([resource('a', '1'), resource('b', '1')], [{}]), exported([resource('a', '2'), resource('c', '1')]))).toEqual([
            'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::a differs in inputs',
            'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::a differs in outputs',
            'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::b is missing',
            'urn:pulumi:dev::shop::aws:ssm/parameter:Parameter::c was not in the source',
            'the source has 1 pending operation(s): an update was interrupted. Run `pulumi refresh` on it first',
            'pending operations differ: 1 → 0',
        ])
    })
    test('config: a secret that differs is named, its value is not', () => {
        expect(configDifferences({ 'shop:key': { value: 'a', secret: true }, 'shop:n': { value: '1' } }, { 'shop:key': { value: 'b', secret: true }, 'shop:n': { value: '1' } }))
            .toEqual(['config shop:key differs (secret; values not shown)'])
    })
})

/** A Pulumi Cloud and a target as the CLI would show them; `deploys` lands a Cloud deploy at the given step. */
const fake = (options: { copy?: (state: object) => object, deploys?: string[], exists?: boolean } = {}) => {
    const calls: string[] = []
    let cloudState: object = exported([resource('a', '1')])
    let cloudVersion = 4
    let targetState: object | undefined = options.exists ? cloudState : undefined
    const config = JSON.stringify({ 'shop:key': { value: 's3cret', secret: true } })
    const ok = (stdout: string): Result => ({ code: 0, stdout, stderr: '' })
    const pulumi: Pulumi = (args, { backend }) => {
        const call = `${backend} ${args.join(' ')}`
        calls.push(call)
        if (options.deploys?.includes(`${calls.filter(c => c === call).length}:${call}`)) { cloudVersion++; cloudState = exported([resource('a', String(cloudVersion))]) }
        if (args[0] === 'stack' && args[1] === 'ls') return ok(JSON.stringify(targetState ? [{ name: 'dev' }] : []))
        if (args[0] === 'stack' && args[1] === 'history') return ok(JSON.stringify([{ version: cloudVersion }]))
        if (args[0] === 'config') return ok(config)
        if (args[0] === 'stack' && args[1] === 'migrate') { targetState = (options.copy ?? (s => s))(cloudState); return ok('') }
        if (args[0] === 'stack' && args[1] === 'import') { targetState = cloudState; return ok('') }
        if (args[0] === 'stack' && args[1] === 'export') return ok(JSON.stringify(backend === 'cloud' ? cloudState : targetState))
        throw new Error(`unexpected ${call}`)
    }
    return { pulumi, calls }
}
const migrate = (pulumi: Pulumi, log: string[] = []) => migrateStack({ pulumi, cwd: '/repo/infra', org: 'petstore', project: 'shop', stack: 'dev', secretsProvider: 'awskms://alias/state', log: l => log.push(l) })

describe('moving a stack', () => {
    test('copies it with the target secrets provider and proves the copy', () => {
        const { pulumi, calls } = fake()
        expect(migrate(pulumi)).toEqual({ version: 4, recopied: false })
        expect(calls).toContain('target stack migrate https://api.pulumi.com petstore/shop/dev --secrets-provider awskms://alias/state --yes')
        expect(calls).toContain('cloud stack export --show-secrets -s petstore/shop/dev')
        expect(calls).toContain('target stack export --show-secrets -s dev')
    })

    test('a deploy to Pulumi Cloud during the move is copied again', () => {
        const { pulumi, calls } = fake({ deploys: ['2:cloud stack history --json --page-size 1 -s petstore/shop/dev'] })
        expect(migrate(pulumi)).toEqual({ version: 5, recopied: true })
        expect(calls).toContain('cloud stack export -s petstore/shop/dev')
        expect(calls.some(c => c.startsWith('target stack import --file '))).toBe(true)
    })

    test('a stack that keeps moving is refused', () => {
        const { pulumi } = fake({ deploys: ['2:cloud stack history --json --page-size 1 -s petstore/shop/dev', '3:cloud stack history --json --page-size 1 -s petstore/shop/dev'] })
        expect(() => migrate(pulumi)).toThrow('petstore/shop/dev keeps moving (version 5 → 6)')
    })

    test('a copy that differs is refused, naming how to remove it', () => {
        const { pulumi } = fake({ copy: () => exported([]) })
        expect(() => migrate(pulumi)).toThrow(/differs from it:\n {2}urn:.*::a is missing[\s\S]*pulumi stack rm --force -s dev/)
    })

    test('a stack already in the target is not copied over', () => {
        const { pulumi, calls } = fake({ exists: true })
        expect(() => migrate(pulumi)).toThrow('dev already exists in the target')
        expect(calls.some(c => c.includes('migrate'))).toBe(false)
    })

    test('a name the backend reads as a wildcard is refused before anything runs', () => {
        const { pulumi, calls } = fake()
        expect(() => migrateStack({ pulumi, cwd: '/repo', org: 'petstore', project: 'pet_shop', stack: 'dev', secretsProvider: 'passphrase', log: () => {} })).toThrow("project 'pet_shop'")
        expect(calls).toEqual([])
    })
})
