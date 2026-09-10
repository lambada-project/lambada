import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { EnvironmentContext, environmentPoolNames, LambadaGrants, resolveEnvironment } from './grants'
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
