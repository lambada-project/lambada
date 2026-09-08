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
    /** Published to every function granted this pool, carrying the pool id. */
    envKeyName: string
    options?: CognitoPoolOptions
    /**
     * Whether the API accepts tokens from this pool. Creating a pool and exposing the API to it are
     * separate decisions: a pool made only to be granted to functions through `resources.pool`
     * should not authorize anything.
     */
    authorizer?: boolean
}

/** A pool that already exists, named so functions can be granted it the same way. */
export type PoolReferenceDefinition = {
    id: pulumi.Input<string>
    arn: pulumi.Input<string>
    envKeyName: string
    /** A referenced pool can authorize the API too — the authorizer takes ARNs, not just resources. */
    authorizer?: boolean
}

export type LambadaPools = { [id: string]: PoolDefinition }
export type LambadaPoolsRef = { [id: string]: PoolReferenceDefinition }

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

const isResultItem = (obj: PoolReferenceDefinition | PoolResultItem): obj is PoolResultItem =>
    !!(obj as PoolResultItem).ref

/**
 * The pools this stack creates and the ones it only references, in that order, the way
 * `createQueues` and `createMessaging` take theirs.
 */
export const createPools = (
    projectName: string,
    environment: string,
    kmsKeys: SecurityResult,
    pools?: LambadaPools,
    poolsRef?: LambadaPoolsRef | PoolsResult
): PoolsResult => {
    const result: PoolsResult = {}

    for (const key in pools) {
        if (Object.prototype.hasOwnProperty.call(pools, key)) {
            const definition = pools[key]
            const awsPool = createUserPool(projectName, environment, kmsKeys, {
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

            result[key] = isResultItem(pool) ? pool : {
                envKeyName: pool.envKeyName,
                ref: { id: pool.id, arn: pool.arn },
                definition: pool
            } satisfies PoolResultItem
        }
    }

    return result
}

/**
 * The pools the API accepts tokens from: the ones tagged for it, never inferred from how many there
 * are, what they are called, or whether this stack created them. The resource for a created pool and
 * the ARN for a referenced one, which is what `getCognitoAuthorizer` takes either of.
 */
export const poolAuthorizers = (pools: PoolsResult): (aws.cognito.UserPool | pulumi.Input<string>)[] =>
    Object.values(pools).filter(x => x.definition.authorizer).map(x => x.awsPool ?? x.ref.arn)

/**
 * `auth.createCognito` as the definition it always meant, so the older switch and the `pools`
 * record produce the same thing. Merged with `pools` by `run()`, where an explicit entry of the
 * same name wins; replacing one with the other would drop a pool that already exists.
 */
type CognitoAuth = {
    createCognito?: boolean
    cognitoOptions?: CognitoPoolOptions & { key?: string, envKeyName?: string }
}

/**
 * The name the pool `auth.createCognito` asks for goes under, or nothing when it asks for none.
 * `run()`'s `cognitoARN` and `cognitoPoolId` mean that pool and only that one, so they are read
 * from here rather than from a tag on the definitions.
 */
export const cognitoPoolKey = (auth?: CognitoAuth): string | undefined =>
    auth?.createCognito ? auth.cognitoOptions?.key ?? DEFAULT_POOL_KEY : undefined

export const cognitoPoolDefinitions = (auth?: CognitoAuth): LambadaPools | undefined => auth?.createCognito
    ? {
        [cognitoPoolKey(auth)!]: {
            envKeyName: auth.cognitoOptions?.envKeyName ?? DEFAULT_POOL_ENV_KEY_NAME,
            options: auth.cognitoOptions,
            authorizer: true
        }
    }
    : undefined
