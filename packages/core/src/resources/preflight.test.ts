import { describe, expect, test } from 'bun:test'
import { LambadaResources } from '../context'
import { createDiagnostics } from './diagnostics'
import { findMissingGrants } from './grants'
import { preflight } from './preflight'

const item = (name: string) => ({ definition: { name, envKeyName: `${name.toUpperCase()}_NAME` }, ref: { name } })

const context = {
    databases: { pets: item('pets'), stores: item('stores') },
    kmsKeys: { signing: item('signing') },
    messaging: { statusChanged: item('statusChanged') },
    queues: { provisioning: item('provisioning') },
    environmentVariables: { STRIPE_KEY: 'sk' },
    projectName: 'proj',
} as unknown as LambadaResources

const run = (definitions: unknown[]) => {
    const diagnostics = createDiagnostics()
    return () => preflight(context, diagnostics, [definitions])
}

describe('preflight', () => {
    test('passes a stack whose every name resolves', () => {
        expect(run([
            { name: 'getPet', resources: { table: { pets: ['dynamodb:GetItem'] }, envVar: ['STRIPE_KEY'] } },
            { name: 'onStatusChanged', topic: 'statusChanged', resources: { table: { stores: ['dynamodb:PutItem'] } } },
            { name: 'markReady', queue: 'provisioning', resources: [] },
        ])).not.toThrow()
    })

    test('reports every bad name at once, rather than stopping at the first', () => {
        let message = ''
        try {
            run([
                { name: 'getPet', resources: { table: { pet: ['dynamodb:GetItem'] } } },
                { name: 'onStatusChanged', topic: 'statusChangd', resources: {} },
                { name: 'markReady', queue: 'provisionin', resources: { envVar: ['STRIPE_KEYY'] } },
            ])()
        } catch (e) {
            message = (e as Error).message
        }

        expect(message).toContain('found 4 resources that are granted but absent')
        expect(message).toContain("table 'pet'")
        expect(message).toContain("topic 'statusChangd'")
        expect(message).toContain("queue 'provisionin'")
        expect(message).toContain("environment variable 'STRIPE_KEYY'")
    })

    test('shows what the stack does carry, so a near miss is obvious', () => {
        expect(run([{ name: 'getPet', resources: { table: { pet: ['dynamodb:GetItem'] } } }]))
            .toThrow(/the stack has: pets, stores/)
    })

    test('reads as a singular sentence for one bad name', () => {
        expect(run([{ name: 'getPet', resources: { table: { pet: ['dynamodb:GetItem'] } } }]))
            .toThrow(/found 1 resource that is granted but absent/)
    })

    test('checks a bound name of any kind, not just topic and queue', () => {
        // Driven off resourceLookups, so a kind is covered by being in that table and nowhere else.
        expect(run([{ name: 'reader', table: 'pet', resources: {} }]))
            .toThrow(/table 'pet' — the stack has: pets, stores/)
        expect(run([{ name: 'signer', kmsKey: 'signng', resources: {} }]))
            .toThrow(/kmsKey 'signng'/)
    })

    test('collects every binding on one declaration, not just the first', () => {
        let message = ''
        try {
            run([{ name: 'both', topic: 'statusChangd', queue: 'provisionin', resources: {} }])()
        } catch (e) {
            message = (e as Error).message
        }

        expect(message).toContain("topic 'statusChangd'")
        expect(message).toContain("queue 'provisionin'")
        expect(message).toContain('found 2 resources')
    })

    test('names an endpoint that left its name out, the way createEndpoint will', () => {
        // `name` is optional and derived from the path later, so preflight derives the same one
        // rather than reporting on undefined — which used to throw inside the message builder.
        expect(run([{ path: '/pets/{id}', method: 'GET', resources: { table: { pet: ['dynamodb:GetItem'] } } }]))
            .toThrow(/proj-pets-id-get\s+table 'pet'/)
    })

    test('falls back to a placeholder when there is nothing to derive a name from', () => {
        expect(run([{ resources: { table: { pet: ['dynamodb:GetItem'] } } }]))
            .toThrow(/\(unnamed\)\s+table 'pet'/)
    })

    test('skips creators, which cannot be inspected without building what they create', () => {
        expect(run([() => { throw new Error('a creator must not run during preflight') }])).not.toThrow()
    })

    test('leaves the older grant-list form alone, since it carries resolved items already', () => {
        expect(run([{ name: 'legacy', resources: [{ arn: 'arn:thing', access: ['sqs:SendMessage'] }] }]))
            .not.toThrow()
    })

    test('accepts a handler bound to an already-resolved topic item', () => {
        expect(run([{ name: 'onStatusChanged', topic: item('statusChanged'), resources: {} }])).not.toThrow()
    })
})

describe('findMissingGrants', () => {
    test('names the kind, the name, and what the stack has', () => {
        expect(findMissingGrants(context, { name: 'getPet', resources: { table: { pet: ['dynamodb:GetItem'] } } })).toEqual([
            { functionName: 'getPet', kind: 'table', name: 'pet', available: ['pets', 'stores'] },
        ])
    })

    test('is empty when every name resolves', () => {
        expect(findMissingGrants(context, { name: 'getPet', resources: { table: { pets: ['dynamodb:GetItem'] } } })).toEqual([])
    })

    test('is empty for the older grant-list form', () => {
        expect(findMissingGrants(context, { name: 'legacy', resources: [{ arn: 'a', access: ['sqs:SendMessage'] }] })).toEqual([])
    })
})
