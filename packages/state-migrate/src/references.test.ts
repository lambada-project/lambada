import { describe, expect, test } from 'bun:test'
import { referenceConfigKeys, rewriteCode, rewriteConfig } from './references'

describe('a stack reference spelled in code', () => {
    test.each([
        ["new StackReference('petstore/catalog/dev')", "new StackReference('organization/catalog/dev')"],
        ['new pulumi.StackReference("petstore/catalog/prod")', 'new pulumi.StackReference("organization/catalog/prod")'],
        ['new StackReference(`petstore/catalog/${environment}`)', 'new StackReference(`organization/catalog/${environment}`)'],
        ['new StackReference(\n    `petstore/orders/${stack}`,\n)', 'new StackReference(\n    `organization/orders/${stack}`,\n)'],
    ])('%s', (source, expected) => {
        const r = rewriteCode(source, 'petstore')
        expect(r.text).toBe(expected)
        expect(r.changes).toHaveLength(1)
        expect(r.unresolved).toEqual([])
    })

    test('leaves another organization, and a name already in the self-managed one', () => {
        const source = "new StackReference('kennel/catalog/dev')\nnew StackReference('organization/catalog/dev')"
        expect(rewriteCode(source, 'petstore')).toEqual({ text: source, changes: [], unresolved: [] })
    })

    test('an organization that is a prefix of another is not matched', () => {
        expect(rewriteCode("new StackReference('petstore-labs/catalog/dev')", 'petstore').changes).toEqual([])
    })

    test('reports a name it cannot see, by line', () => {
        const r = rewriteCode("const a = 1\nnew StackReference(name)\nnew StackReference(`${org}/catalog/dev`)", 'petstore')
        expect(r.changes).toEqual([])
        expect(r.unresolved.map(u => [u.line, u.text])).toEqual([[3, '${org}/catalog/dev'], [2, 'name']])
    })

    test('reports, without rewriting, a literal naming the organization elsewhere', () => {
        const source = "const CATALOG = 'petstore/catalog/dev'\nconst image = 'petstore/api:latest'"
        const r = rewriteCode(source, 'petstore')
        expect(r.text).toBe(source)
        expect(r.unresolved.map(u => u.line)).toEqual([1])
    })

    test('a reference whose name comes from config is left to the config', () => {
        const source = "new StackReference(config.require('catalogStack'))\nnew StackReference(cfg.get(\"ordersStack\"))"
        expect(rewriteCode(source, 'petstore').unresolved).toEqual([])
        expect(referenceConfigKeys(source)).toEqual(['catalogStack', 'ordersStack'])
    })
})

describe('a stack reference in stack config', () => {
    const yaml = [
        'config:',
        '  aws:region: us-east-1',
        '  shop:catalogStack: petstore/catalog/dev',
        '  ordersStack: "petstore/orders/dev"',
        '  shop:owner: petstore/catalog/dev',
        '  shop:secretStack:',
        '    secure: v1:abc',
        '',
    ].join('\n')

    test('rewrites the plain values of the referenced keys only', () => {
        const r = rewriteConfig(yaml, 'petstore', ['catalogStack', 'ordersStack', 'secretStack'])
        expect(r.text).toContain('  shop:catalogStack: organization/catalog/dev')
        expect(r.text).toContain('  ordersStack: "organization/orders/dev"')
        expect(r.text).toContain('  shop:owner: petstore/catalog/dev')
        expect(r.changes.map(c => c.line)).toEqual([3, 4])
        expect(r.unresolved.map(u => [u.line, u.text])).toEqual([[6, 'secretStack']])
    })

    test('no keys, no change', () => {
        expect(rewriteConfig(yaml, 'petstore', [])).toEqual({ text: yaml, changes: [], unresolved: [] })
    })
})
