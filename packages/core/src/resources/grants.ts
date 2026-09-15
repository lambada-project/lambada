import * as pulumi from "@pulumi/pulumi";

import { LambadaResources } from "../context";
import { EmbroideryEnvironmentVariables } from "..";
import { MissingResource } from "./diagnostics";
import {
    CognitoAccess,
    DynamoDbAccess,
    KmsAccess,
    LambdaResource,
    SecretAccess,
    S3Access,
    SNSAccess,
    SQSAccess,
} from "../lambdas";


export type LambadaGrantsShape = {
    table?: string
    bucket?: string
    topic?: string
    queue?: string
    secret?: string
    kmsKey?: string
    pool?: string
    envVar?: string
}

type GrantMap<TName, TAccess extends string> = Partial<Record<TName & string, readonly TAccess[]>>

export type LambadaGrants<TNames extends LambadaGrantsShape = LambadaGrantsShape> = {
    table?: GrantMap<TNames['table'], DynamoDbAccess>
    bucket?: GrantMap<TNames['bucket'], S3Access>
    topic?: GrantMap<TNames['topic'], SNSAccess>
    queue?: GrantMap<TNames['queue'], SQSAccess>
    secret?: GrantMap<TNames['secret'], SecretAccess>
    kmsKey?: GrantMap<TNames['kmsKey'], KmsAccess>
    pool?: GrantMap<TNames['pool'], CognitoAccess>
    /** environment variables this function may use, excluding global variables. */
    envVar?: readonly (TNames['envVar'] & string)[]
}

export type LambadaResourceRequest<TNames extends LambadaGrantsShape = LambadaGrantsShape> =
    LambdaResource[] | LambadaGrants<TNames>

export type GrantContext = Pick<
    LambadaResources,
    'databases' | 'buckets' | 'secrets' | 'messaging' | 'queues' | 'kmsKeys' | 'pools'
>

export type EnvironmentContext = Pick<LambadaResources, 'environmentVariables' | 'globalEnvironmentVariables'>

export const isLambadaGrants = (
    resources: LambadaResourceRequest<any> | undefined
): resources is LambadaGrants<any> => !!resources && !Array.isArray(resources)


export type ResourceRef<T> = T | string

export type ResourceAsk = {
    /** The function this resolves for, so a failure can name it. */
    name: string
    resources: LambadaResourceRequest<any> | undefined
}

export type GrantMapAsk = { name: string, resources: LambadaGrants<any> }

export type EnvironmentAsk = ResourceAsk & {
    /** What the function sets for itself, which wins over everything the stack publishes. */
    environmentVariables: EmbroideryEnvironmentVariables
}

/** One name, looked up in the record that carries its kind. */
export type LookupAsk<TRef> = { name: string, kind: string, ref: TRef }

/** The item, whichever way it was given. */
export const resolveRef = <T>(
    record: Record<string, T> | undefined,
    { name, kind, ref }: LookupAsk<ResourceRef<T>>
): T => (typeof ref === 'string' ? requireItem(record, { name, kind, ref }) : ref)

/**
 * A named item this stack must carry, throwing with the kind and the name when it does not. A
 * missing resource is a misconfiguration: granting nothing, or granting `undefined`, produces a
 * function that fails on its first call instead of at deploy time.
 *
 * The backstop, not the usual path. `preflight` checks every name a plain declaration uses before
 * anything is built and reports them together, so this only fires for a creator, which cannot be
 * inspected without executing it. One at a time is the best that path allows.
 */
export const requireItem = <T>(
    record: Record<string, T> | undefined,
    { name, kind, ref }: LookupAsk<string>
): T => {
    const item = record?.[ref]
    if (item === undefined) {
        const available = Object.keys(record ?? {})
        throw new Error(
            `Resource not found: ${name} needs ${kind} '${ref}', which is absent from the ` +
            `stack. The stack has: ${available.length ? available.join(', ') : 'none'}.`
        )
    }
    return item
}

const entries = (map: GrantMap<string, string> | undefined): [string, readonly string[]][] =>
    Object.entries(map ?? {}) as [string, readonly string[]][]

/** Every grant in the map, as the `LambdaResource[]` the rest of lambada already speaks. */
export const toLambdaResources = (
    context: GrantContext,
    { name, resources }: GrantMapAsk
): LambdaResource[] => [
    ...entries(resources.table).map(([ref, access]) =>
        ({ table: requireItem(context.databases, { name, kind: 'table', ref }), access: [...access] })),
    ...entries(resources.bucket).map(([ref, access]) =>
        ({ bucket: requireItem(context.buckets, { name, kind: 'bucket', ref }), access: [...access] })),
    ...entries(resources.topic).map(([ref, access]) =>
        ({ topic: requireItem(context.messaging, { name, kind: 'topic', ref }), access: [...access] })),
    ...entries(resources.queue).map(([ref, access]) =>
        ({ queue: requireItem(context.queues, { name, kind: 'queue', ref }), access: [...access] })),
    ...entries(resources.secret).map(([ref, access]) =>
        ({ secret: requireItem(context.secrets, { name, kind: 'secret', ref }), access: [...access] })),
    ...entries(resources.kmsKey).map(([ref, access]) =>
        ({ kmsKey: requireItem(context.kmsKeys, { name, kind: 'kmsKey', ref }), access: [...access] })),
    ...entries(resources.pool).map(([ref, access]) =>
        ({ pool: requireItem(context.pools, { name, kind: 'pool', ref }), access: [...access] })),
]

/**
 * Grants for either form, always as a fresh array. Callers append to what comes back — a kms key,
 * the handler's own queue — and a caller's array must not collect those on every deploy.
 */
export const resolveGrants = (context: GrantContext, { name, resources }: ResourceAsk): LambdaResource[] =>
    isLambadaGrants(resources)
        ? toLambdaResources(context, { name, resources })
        : [...((resources as LambdaResource[] | undefined) ?? [])]

/**
 * A pool can only be picked from when its keys are known here. A whole-record `Input` resolves too
 * late for that, so it is passed through untouched rather than silently emptied.
 */
const asRecord = (
    values: EmbroideryEnvironmentVariables
): Record<string, pulumi.Input<string>> | undefined => {
    if (!values) return {}
    if (pulumi.Output.isInstance(values) || values instanceof Promise) return undefined
    return values as Record<string, pulumi.Input<string>>
}

/** The names in the pool, empty when its keys cannot be known here. */
export const environmentPoolNames = (values: EmbroideryEnvironmentVariables): string[] =>
    Object.keys(asRecord(values) ?? {})

/**
 * Every kind of resource a name can refer to, and the record it resolves against. The one place
 * that list lives: grants resolve through it, and so does the pre-flight check on the resource a
 * handler binds to.
 */
export const resourceLookups = (
    context: GrantContext
): Record<ResourceKind, Record<string, unknown> | undefined> => ({
    table: context.databases,
    bucket: context.buckets,
    topic: context.messaging,
    queue: context.queues,
    secret: context.secrets,
    kmsKey: context.kmsKeys,
    pool: context.pools,
})

export type ResourceKind = 'table' | 'bucket' | 'topic' | 'queue' | 'secret' | 'kmsKey' | 'pool'

/**
 * Every name in a grant map the stack cannot resolve. Unlike `toLambdaResources` this reports all
 * of them instead of stopping at the first, so `run()` can collect across the whole stack before
 * anything is built.
 */
export const findMissingGrants = (
    context: GrantContext & Pick<LambadaResources, 'environmentVariables'>,
    { name, resources }: ResourceAsk
): MissingResource[] => {
    if (!isLambadaGrants(resources)) return []

    const found: MissingResource[] = []
    const check = (kind: string, ref: string, record: Record<string, unknown> | undefined) => {
        if (record?.[ref] === undefined) {
            found.push({ functionName: name, kind, name: ref, available: Object.keys(record ?? {}) })
        }
    }

    for (const [kind, record] of Object.entries(resourceLookups(context))) {
        for (const ref of Object.keys((resources as Record<string, object>)[kind] ?? {})) {
            check(kind, ref, record)
        }
    }

    const pool = asRecord(context.environmentVariables)
    if (pool) {
        for (const ref of resources.envVar ?? []) check('environment variable', ref, pool)
    }

    return found
}

/**
 * What one function may read: the stack's globals, plus what it picked from the pool, plus its own.
 *
 * The form of `resources` decides. A declarative map picks by name through `envVar`, so a map with no
 * `envVar` picks nothing. The older grant list has no way to name anything, so it receives the whole
 * pool, exactly as it did before the pool existed.
 */
export const resolveEnvironment = (
    context: EnvironmentContext,
    { name, resources, environmentVariables }: EnvironmentAsk
): EmbroideryEnvironmentVariables => {
    const globals = context.globalEnvironmentVariables || {}
    const own = environmentVariables || {}
    const all = asRecord(context.environmentVariables)

    // A whole-record Input has no keys until after deployment, so it can neither be picked from nor
    // merged: spreading one yields the Output's own fields as env vars. Individual values may be
    // Inputs, which is the shape to use instead.
    if (!all) {
        throw new Error(
            `environmentVariables must be a plain record, but this stack's is an Input whose keys are ` +
            `not known until after deployment, so ${name} cannot be given values from it. Each value ` +
            `may be an Input; the record holding them may not.`
        )
    }

    if (!isLambadaGrants(resources)) return { ...(globals as object), ...all, ...own }

    const picked: Record<string, pulumi.Input<string>> = {}
    for (const ref of resources.envVar ?? []) {
        picked[ref] = requireItem(all, { name, kind: 'environment variable', ref })
    }

    return { ...(globals as object), ...picked, ...own }
}
