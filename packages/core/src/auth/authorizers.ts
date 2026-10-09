import * as awsx from "@pulumi/awsx/classic";
import { CognitoAuthorizer, LambdaAuthorizer } from "@pulumi/awsx/classic/apigateway";
import { createDiagnostics, MissingResource } from "../resources/diagnostics";
import { PoolsResult } from "./pools";

/** Tokens from the pool declared under this key in `pools` or `poolsRef`. */
export type PoolAuthorizerDefinition = { pool: string }

/**
 * An authorizer the API can run, declared under the name endpoints select it by. That name is also
 * what API Gateway calls it, so a lambda authorizer's own `authorizerName` gives way to it.
 */
export type AuthorizerDefinition = PoolAuthorizerDefinition | LambdaAuthorizer

export type LambadaAuthorizers = { [name: string]: AuthorizerDefinition }

/** The declared authorizer a method runs, or `false` for a public one. API Gateway runs one per method. */
export type AuthorizerSelection = string | false

export type MethodAuthorizer = CognitoAuthorizer | LambdaAuthorizer

export type Authorization = {
    /** What a method runs, and every name it uses that the stack lacks. */
    select(functionName: string, selection: AuthorizerSelection | undefined): {
        authorizers: MethodAuthorizer[]
        missing: MissingResource[]
    }
    /** The authorizers a method runs; throws naming what the stack lacks. */
    resolve(functionName: string, selection: AuthorizerSelection | undefined): MethodAuthorizer[]
}

const isPoolDefinition = (definition: AuthorizerDefinition): definition is PoolAuthorizerDefinition =>
    'pool' in definition

/**
 * The key names the authorizer in API Gateway, which allows [a-zA-Z0-9._-] up to 1024, and names the
 * function awsx builds for a lambda authorizer's handler, which refuses the '.'.
 */
const NAME = /^[A-Za-z0-9_-]{1,1024}$/

/**
 * awsx registers authorizers in a plain object, where a name an object inherits reads as already taken,
 * and writes the API key's security definition as `api_key`.
 */
const isReserved = (name: string) => name in {} || name === 'api_key'

export const createAuthorization = (
    definitions: LambadaAuthorizers,
    pools: PoolsResult,
    defaultSelection: AuthorizerSelection | undefined
): Authorization => {
    for (const name of Object.keys(definitions)) {
        if (!NAME.test(name)) {
            throw new Error(`Cannot declare the authorizer '${name}': use up to 1024 letters, digits, '-' and '_'.`)
        }
        if (isReserved(name)) {
            throw new Error(`Cannot declare the authorizer '${name}': awsx keeps that name for itself. Choose another.`)
        }
    }

    const declares = (name: string) => Object.prototype.hasOwnProperty.call(definitions, name)
    const hasPool = (key: string) => Object.prototype.hasOwnProperty.call(pools, key)

    // One per name, so every method selecting it shares the authorizer API Gateway imports.
    const built = new Map<string, MethodAuthorizer>()
    const build = (name: string): MethodAuthorizer => {
        if (!built.has(name)) {
            const definition = definitions[name]
            built.set(name, isPoolDefinition(definition)
                ? awsx.apigateway.getCognitoAuthorizer({
                    authorizerName: name,
                    providerARNs: [pools[definition.pool].awsPool ?? pools[definition.pool].ref.arn],
                })
                : { ...definition, authorizerName: name })
        }
        return built.get(name)!
    }

    const check = (functionName: string, name: string): MissingResource[] => {
        if (!declares(name)) return [{ functionName, kind: 'authorizer', name, available: Object.keys(definitions) }]

        const definition = definitions[name]
        return isPoolDefinition(definition) && !hasPool(definition.pool)
            ? [{ functionName, kind: 'pool', name: definition.pool, available: Object.keys(pools) }]
            : []
    }

    const select: Authorization['select'] = (functionName, selection) => {
        const name = selection ?? defaultSelection ?? false
        if (name === false) return { authorizers: [], missing: [] }

        const missing = check(functionName, name)
        return { authorizers: missing.length > 0 ? [] : [build(name)], missing }
    }

    return {
        select,
        resolve(functionName, selection) {
            const { authorizers, missing } = select(functionName, selection)
            const diagnostics = createDiagnostics()
            missing.forEach(diagnostics.missingResource)
            diagnostics.throwIfIncomplete()
            return authorizers
        },
    }
}

/** How an endpoint or proxy asks for authorizers, in either style. */
export type EndpointAuthorizers = {
    useCognitoAuthorizer?: boolean
    lambdaAuthorizer?: LambdaAuthorizer
    /** The positional switch of `createEndpoint` and the proxy integrations. */
    enableAuth?: boolean
    authorizer?: AuthorizerSelection
}

const deprecatedFields = ['useCognitoAuthorizer', 'lambdaAuthorizer', 'enableAuth'] as const
const fieldName = (field: typeof deprecatedFields[number]) => field === 'enableAuth' ? field : `auth.${field}`

/** An endpoint written in the other style from its stack, which would otherwise be ignored. */
export const styleProblems = (
    authorization: Authorization | undefined,
    functionName: string,
    auth: EndpointAuthorizers | undefined
): string[] => {
    if (authorization) {
        const deprecated = deprecatedFields.filter(f => auth?.[f] !== undefined)
        return deprecated.length === 0 ? [] : [
            `${functionName}: sets ${deprecated.map(fieldName).join(' and ')}, but run() declares ` +
            `authorizers by name. Select one with auth.authorizer.`
        ]
    }

    return auth?.authorizer === undefined ? [] : [
        `${functionName}: selects auth.authorizer, but run() declares none in auth.authorizers.`
    ]
}
