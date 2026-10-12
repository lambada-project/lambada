import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { EnvironmentContext, environmentPoolNames, findMissingGrants, LambadaEnvironmentVariables, LambadaGrants, requireDistinctVariables, resolveEnvironment } from './grants'
import { LambdaResource } from '../lambdas'

const context = (over: Partial<EnvironmentContext> = {}): EnvironmentContext => ({
    environmentVariables: { BANK_KEY: 'bk', SEGMENT_KEY: 'sg' },
    globalEnvironmentVariables: { LAMBADA_SHOW_ALL_ERRORS: 'true' },
    ...over,
})

// Annotated, so the access arrays keep the template-literal types the grant map asks for rather
// than widening to string[].
const declaring = (...names: string[]): LambadaGrants => ({ table: { pets: ['dynamodb:GetItem'] }, envVar: names })
const declarative: LambadaGrants = { table: { pets: ['dynamodb:GetItem'] } }
const legacy: LambdaResource[] = [{ arn: 'arn:thing', access: ['sqs:SendMessage'] }]

describe('resolveEnvironment', () => {
    test('gives a declarative function the globals plus only what it named', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: declaring('BANK_KEY'), environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            BANK_KEY: 'bk',
        })
    })

    test('withholds the rest of the pool, which is the point', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: declaring('BANK_KEY'), environmentVariables: undefined })).not.toHaveProperty('SEGMENT_KEY')
    })

    test('gives a declarative function with no envVar the globals and nothing else', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: declarative, environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
        })
    })

    test('reads an empty envVar as none, because the form already said it picks by name', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: declaring(), environmentVariables: undefined })).toEqual(
            resolveEnvironment(context(), { name: 'getPet', resources: declarative, environmentVariables: undefined }),
        )
    })

    test('gives the older grant list the whole pool, as it received before the pool existed', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: legacy, environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            BANK_KEY: 'bk',
            SEGMENT_KEY: 'sg',
        })
    })

    test('gives a function that declares no resources at all the whole pool too', () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: undefined, environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            BANK_KEY: 'bk',
            SEGMENT_KEY: 'sg',
        })
    })

    test('scopes each function by its own form across one stack', () => {
        const scoped = resolveEnvironment(context(), { name: 'getPet', resources: declaring('SEGMENT_KEY'), environmentVariables: undefined }) as object
        const unscoped = resolveEnvironment(context(), { name: 'getPet', resources: legacy, environmentVariables: undefined }) as object

        expect(Object.keys(scoped).sort()).toEqual(['LAMBADA_SHOW_ALL_ERRORS', 'SEGMENT_KEY'])
        expect(Object.keys(unscoped).sort()).toEqual(['BANK_KEY', 'LAMBADA_SHOW_ALL_ERRORS', 'SEGMENT_KEY'])
    })

    test("lets the function's own values win over both", () => {
        expect(resolveEnvironment(context(), { name: 'getPet', resources: declaring('BANK_KEY'), environmentVariables: { BANK_KEY: 'override', OWN: 'x' } })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            BANK_KEY: 'override',
            OWN: 'x',
        })
    })

    test('throws naming a value the stack does not publish', () => {
        expect(() => resolveEnvironment(context(), { name: 'getPet', resources: declaring('NOPE'), environmentVariables: undefined })).toThrow(
            "Resource not found: getPet needs environment variable 'NOPE', which is absent from the stack.",
        )
    })

    test('refuses a whole-record Input rather than spreading the Output into env vars', () => {
        // Spreading one yields __pulumiOutput / promise / toString as environment variables, and a
        // declarative function would receive the whole pool instead of only its picks.
        const pool = pulumi.output({ BANK_KEY: 'bk' }) as unknown as EnvironmentContext['environmentVariables']

        expect(() => resolveEnvironment(context({ environmentVariables: pool }), {
            name: 'getPet', resources: declarative, environmentVariables: { OWN: 'x' },
        })).toThrow(/environmentVariables must be a plain record/)
    })

    test('accepts a plain record whose values are Inputs, which is the shape to use', () => {
        const values = { BANK_KEY: pulumi.output('bk') } as unknown as EnvironmentContext['environmentVariables']
        const resolved = resolveEnvironment(context({ environmentVariables: values }), {
            name: 'getPet', resources: declaring('BANK_KEY'), environmentVariables: undefined,
        }) as Record<string, unknown>

        expect(Object.keys(resolved).sort()).toEqual(['BANK_KEY', 'LAMBADA_SHOW_ALL_ERRORS'])
    })

    test('works with no pool and no globals', () => {
        const bare = { environmentVariables: undefined, globalEnvironmentVariables: undefined }

        expect(resolveEnvironment(bare, { name: 'getPet', resources: declarative, environmentVariables: undefined })).toEqual({})
        expect(resolveEnvironment(bare, { name: 'getPet', resources: legacy, environmentVariables: { OWN: 'x' } })).toEqual({ OWN: 'x' })
    })
})

describe('environmentPoolNames', () => {
    test('names what the pool holds', () => {
        expect(environmentPoolNames({ A: '1', B: '2' })).toEqual(['A', 'B'])
    })

    test('is empty for a whole-record Output, whose keys are not known here', () => {
        const pool = pulumi.output({ A: '1' }) as unknown as EnvironmentContext['environmentVariables']

        expect(environmentPoolNames(pool)).toEqual([])
    })
})

describe('a pool entry that names its variable', () => {
    const keyed = (over: Partial<EnvironmentContext> = {}) => context({
        environmentVariables: {
            pageSize: { envKeyName: 'PAGE_SIZE', value: '20' },
            SEGMENT_KEY: 'sg',
        },
        ...over,
    })

    test('is granted by its key and set under its envKeyName', () => {
        expect(resolveEnvironment(keyed(), { name: 'listPets', resources: declaring('pageSize'), environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            PAGE_SIZE: '20',
        })
    })

    test('is not granted by its envKeyName, which is not a name in the pool', () => {
        expect(() => resolveEnvironment(keyed(), { name: 'listPets', resources: declaring('PAGE_SIZE'), environmentVariables: undefined }))
            .toThrow('PAGE_SIZE')
        expect(findMissingGrants({ environmentVariables: keyed().environmentVariables } as never, { name: 'listPets', resources: declaring('PAGE_SIZE') }))
            .toContainEqual({ functionName: 'listPets', kind: 'environment variable', name: 'PAGE_SIZE', available: ['pageSize', 'SEGMENT_KEY'] })
    })

    test('reaches the older grant list under its envKeyName too', () => {
        expect(resolveEnvironment(keyed(), { name: 'listPets', resources: legacy, environmentVariables: undefined })).toEqual({
            LAMBADA_SHOW_ALL_ERRORS: 'true',
            PAGE_SIZE: '20',
            SEGMENT_KEY: 'sg',
        })
    })

    test('carries an Input value', () => {
        const value = pulumi.output('secret')
        const resolved = resolveEnvironment(keyed({ environmentVariables: { cacheTtl: { envKeyName: 'CACHE_TTL', value } } }), { name: 'listPets', resources: declaring('cacheTtl'), environmentVariables: undefined })
        expect((resolved as Record<string, unknown>).CACHE_TTL).toBe(value)
    })
})

describe('requireDistinctVariables', () => {
    test.each([
        { pool: { a: { envKeyName: 'SAME', value: '1' }, b: { envKeyName: 'SAME', value: '2' } }, reason: 'a, b all set SAME' },
        { pool: { a: { envKeyName: 'SAME', value: '1' }, SAME: '2' }, reason: 'a, SAME all set SAME' },
        { pool: { quiet: { envKeyName: 'LAMBADA_SHOW_ALL_ERRORS', value: 'false' } }, reason: 'quiet set LAMBADA_SHOW_ALL_ERRORS, which globalEnvironmentVariables already sets' },
        { pool: { LAMBADA_SHOW_ALL_ERRORS: 'false' }, reason: 'LAMBADA_SHOW_ALL_ERRORS set LAMBADA_SHOW_ALL_ERRORS, which globalEnvironmentVariables' },
    ] as { pool: LambadaEnvironmentVariables, reason: string }[])('refuses one variable with two values: $reason', ({ pool, reason }) => {
        expect(() => requireDistinctVariables(pool, { LAMBADA_SHOW_ALL_ERRORS: 'true' })).toThrow(reason)
    })

    test('passes a pool whose variables are each set once', () => {
        expect(() => requireDistinctVariables({ cacheTtl: { envKeyName: 'CACHE_TTL', value: '1' }, SEGMENT_KEY: 'sg' }, { LAMBADA_SHOW_ALL_ERRORS: 'true' })).not.toThrow()
    })
})
