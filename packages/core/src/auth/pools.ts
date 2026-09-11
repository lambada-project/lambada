import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { SecurityResult } from "../security";
import createUserPool from ".";

export type CognitoPoolOptions = {
    useEmailAsUsername?: boolean
    preventResourceDeletion?: boolean
}

/** A cognito user pool this stack creates, keyed like every other definition record. */
export type PoolDefinition = {
    /** What the pool is called, as `${name}-${environment}`. Renaming one replaces it. */
    name: string
    /** Published to every function granted this pool, carrying the pool id. */
    envKeyName: string
    options?: CognitoPoolOptions
}

/** A pool that already exists, named so functions can be granted it the same way. */
export type PoolReferenceDefinition = {
    id: pulumi.Input<string>
    arn: pulumi.Input<string>
    envKeyName: string
}

export type LambadaPools = { [id: string]: PoolDefinition }

/** A definition's `name` is the full physical name here; the explicit form gives id and arn. */
export type LambadaPoolsRef = { [id: string]: PoolDefinition | PoolReferenceDefinition }

/** What `createUserPool` calls a pool in AWS. */
export const poolName = (name: string, environment: string) => `${name}-${environment}`

const isReferenceDefinition = (obj: PoolDefinition | PoolReferenceDefinition): obj is PoolReferenceDefinition =>
    'arn' in obj

/** Cognito does not require a pool name to be unique, so two matches is an error, not a pick. */
export const onlyPool = <T>(poolNameInAws: string, values: readonly T[]): T => {
    if (values.length !== 1) {
        throw new Error(
            `Cannot reference the pool '${poolNameInAws}': the account has ${values.length} of that name, not one.`,
        )
    }

    return values[0]
}

const findPool = (name: string, environment: string): PoolReference => {
    const poolNameInAws = poolName(name, environment)
    const found = pulumi.output(aws.cognito.getUserPools({ name: poolNameInAws }, { async: true }))

    return {
        id: found.ids.apply(ids => onlyPool(poolNameInAws, ids)),
        arn: found.arns.apply(arns => onlyPool(poolNameInAws, arns)),
    }
}

type PoolReference = {
    id: pulumi.Input<string>
    arn: pulumi.Input<string>
}

export type PoolResultItem = {
    /** The pool itself, when this stack created it rather than referencing one. */
    awsPool?: aws.cognito.UserPool
    envKeyName: string
    ref: PoolReference
    definition: PoolDefinition | PoolReferenceDefinition
}

export type PoolsResult = { [id: string]: PoolResultItem }

/** What `auth.createCognito` has always meant, before pools could be declared by name. */
export const DEFAULT_POOL_KEY = 'userPool'
export const DEFAULT_POOL_ENV_KEY_NAME = 'COGNITO_USER_POOL_ID'

const isResultItem = (obj: PoolDefinition | PoolReferenceDefinition | PoolResultItem): obj is PoolResultItem =>
    !!(obj as PoolResultItem).ref

/**
 * Every pool this stack declares, and the key of the one `auth.createCognito` asked for.
 *
 * The two sources are merged rather than either-or, so declaring a second pool never drops the
 * first. They may not both claim one key: letting `pools` win there is silent, and the winner
 * brings its own `name` — a different one renames the pool, and a renamed pool is replaced.
 */
const poolDefinitions = (
    projectName: string,
    auth?: CognitoAuth,
    pools?: LambadaPools
): { definitions?: LambadaPools, cognitoKey?: string } => {
    if (!auth?.createCognito) return { definitions: pools }

    const cognitoKey = auth.cognitoOptions?.key ?? DEFAULT_POOL_KEY

    if (pools?.[cognitoKey]) {
        throw new Error(
            `auth.createCognito already declares the pool '${cognitoKey}'. Rename the pools entry, ` +
            `give auth.cognitoOptions.key another name, or drop createCognito — overriding it here ` +
            `would rename the pool, and a renamed pool is replaced.`
        )
    }

    return {
        cognitoKey,
        definitions: {
            [cognitoKey]: {
                // The name auth.createCognito has always produced. Deriving it from the key would
                // rename the pool, and a renamed pool is replaced, taking its users with it.
                name: projectName,
                envKeyName: auth.cognitoOptions?.envKeyName ?? DEFAULT_POOL_ENV_KEY_NAME,
                options: auth.cognitoOptions
            },
            ...pools
        }
    }
}

/**
 * The pools this stack creates and the ones it only references, the way `createQueues` and
 * `createMessaging` take theirs, plus what `auth.createCognito` asks for.
 *
 * `auth` carries the single-pool outputs `run()` has always returned, which mean the pool that
 * switch created and no other. A stack declaring `pools` itself reads them off the result.
 */
export const createPools = (
    projectName: string,
    environment: string,
    kmsKeys: SecurityResult,
    auth?: CognitoAuth,
    declaredPools?: LambadaPools,
    poolsRef?: LambadaPoolsRef | PoolsResult
): {
    pools: PoolsResult
    /** Provider ARNs for the API's cognito authorizer. */
    authorizers: (aws.cognito.UserPool | pulumi.Input<string>)[]
    /** Keys always present, as `run()` has always returned them; the values may be undefined. */
    auth: { cognitoARN: pulumi.Output<string> | undefined, cognitoPoolId: pulumi.Output<string> | undefined }
} => {
    const { definitions: pools, cognitoKey } = poolDefinitions(projectName, auth, declaredPools)
    const result: PoolsResult = {}

    const names = new Set<string>()
    for (const key in pools) {
        if (Object.prototype.hasOwnProperty.call(pools, key)) {
            // Two pools of one name are one resource declared twice, which the engine refuses far
            // from here.
            if (names.has(pools[key].name)) {
                throw new Error(`Cannot create two pools named ${pools[key].name}: ${key} repeats it.`)
            }
            names.add(pools[key].name)

            const definition = pools[key]
            const awsPool = createUserPool(definition.name, environment, kmsKeys, {
                useEmailAsUsername: definition.options?.useEmailAsUsername,
                protect: definition.options?.preventResourceDeletion
            })

            result[key] = {
                awsPool,
                envKeyName: definition.envKeyName,
                ref: { id: awsPool.id, arn: awsPool.arn },
                definition
            } satisfies PoolResultItem
        }
    }

    for (const key in poolsRef) {
        if (Object.prototype.hasOwnProperty.call(poolsRef, key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref pool with the same name of an existing pool: ${key}`)
            }

            const pool = poolsRef[key]

            if (isResultItem(pool)) {
                result[key] = pool
            } else {
                result[key] = {
                    envKeyName: pool.envKeyName,
                    ref: isReferenceDefinition(pool) ? { id: pool.id, arn: pool.arn } : findPool(pool.name, environment),
                    definition: pool
                } satisfies PoolResultItem
            }
        }
    }

    const cognitoPool = cognitoKey ? result[cognitoKey]?.awsPool : undefined

    // The pool createCognito builds has always authorized, so it joins the pick rather than needing
    // to be named in it.
    const picked = [...(auth?.authorizerPools ?? [])]
    if (cognitoKey && !picked.includes(cognitoKey)) picked.push(cognitoKey)

    return {
        pools: result,
        authorizers: poolAuthorizers(result, picked),
        auth: { cognitoARN: cognitoPool?.arn, cognitoPoolId: cognitoPool?.id }
    }
}

/**
 * The picked pools as provider ARNs: the resource for one this stack created, the arn for one it
 * only references, which is what `getCognitoAuthorizer` takes either of. A name that no pool answers
 * to is refused here rather than producing an API that trusts nothing.
 */
const poolAuthorizers = (
    pools: PoolsResult,
    picked: readonly string[]
): (aws.cognito.UserPool | pulumi.Input<string>)[] => picked.map(key => {
    const pool = pools[key]

    if (!pool) {
        const available = Object.keys(pools)
        throw new Error(
            `Cannot authorize with pool '${key}': no pool is declared under that name. ` +
            `The stack has: ${available.length ? available.join(', ') : 'none'}.`
        )
    }

    return pool.awsPool ?? pool.ref.arn
})

/**
 * `auth.createCognito` as the definition it always meant, so the older switch and the `pools`
 * record produce the same thing. Merged with `pools` by `run()`, where an explicit entry of the
 * same name wins; replacing one with the other would drop a pool that already exists.
 */
type CognitoAuth = {
    createCognito?: boolean
    cognitoOptions?: CognitoPoolOptions & { key?: string, envKeyName?: string }
    /**
     * Which pools the API accepts tokens from, by the name each is declared under — created or
     * referenced alike. Whether a pool exists and whether the API trusts it are separate decisions,
     * so this is a pick over them rather than a mark on each.
     *
     * The pool `createCognito` builds is always among them, as it has always been.
     */
    authorizerPools?: readonly string[]
}
