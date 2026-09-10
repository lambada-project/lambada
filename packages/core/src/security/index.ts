import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import { KeyArgs } from '@pulumi/aws/kms/key.d'
import { LambadaDiagnostics } from '../resources/diagnostics'
export * from './secrets'

type KeyParams = Omit<KeyArgs, "tags" | 'description'>

/** A key outside the naming convention, addressed by id: the fetched key carries everything else. */
export type KeyReferenceDefinition = {
    id: pulumi.Input<string>
    envKeyName: string
}

/**
 * The alias `CreateKey` gives every key it makes, and the only handle a name-based ref can use.
 * `name` is the full physical name: an owner passes `${projectName}-${key.name}`, a ref spells it.
 */
export const keyAlias = (name: string, environment: string) => `alias/${name}-${environment}`

export function CreateKey(item: SecurityKeyItem, name: string, environment: string, args: KeyParams): SecurityResultItem {
    const keyname = `${name}-${environment}`

    const key = new aws.kms.Key(keyname, {
        deletionWindowInDays: 30,
        description: `KMS key: ${name} - Environment: ${environment} - Created by Embroidery`,
        tags: {
            'CreatedBy': 'Embroidery',
            'Environment': environment
        },
        ...args
    })

    // A key has no name in AWS, so without this a consumer has nothing to reference it by.
    new aws.kms.Alias(`alias/${keyname}`, {
        name: keyAlias(name, environment),
        targetKeyId: key.keyId
    })

    return {
        awsKmsKey: key,
        definition: item
    }
}

export type SecurityKeyItem = {
    name: string
    envKeyName: string
    options?: KeyParams
} | undefined

export type SecurityKeys = {
    [id: string]: SecurityKeyItem
    dynamodb?: SecurityKeyItem
}

/**
 * Keys this stack only references: by the same definition a stack creating one writes, resolved
 * through the alias, or by id for a key outside the convention.
 */
export type SecurityKeysRef = {
    /** A definition's `name` is the full physical name here, project prefix and all. */
    [id: string]: SecurityKeyItem | KeyReferenceDefinition
}

const isKeyReferenceDefinition = (item: SecurityKeyItem | KeyReferenceDefinition): item is KeyReferenceDefinition =>
    !!item && 'id' in item

const isResultItem = (item: SecurityResultItem | SecurityKeyItem | KeyReferenceDefinition): item is SecurityResultItem =>
    !!item && 'awsKmsKey' in item

/**
 * The key an alias points at, as the resource itself. Fetched rather than reduced to an arn so a
 * referenced key and an owned one are the same thing to every reader, as `findSecret` does.
 */
function findKey(name: string, environment: string): aws.kms.Key {
    const alias = pulumi.output(aws.kms.getAlias({ name: keyAlias(name, environment) }, { async: true }))

    return aws.kms.Key.get(`${name}-${environment}`, alias.targetKeyId)
}

export function createKMSKeys(projectName: string, environment: string, keys: SecurityKeys | undefined, keysRef: SecurityKeysRef | SecurityResult | undefined): SecurityResult {
    const result: SecurityResult = {}

    // Also created by the loop below, under `${projectName}-${name}`, which wins the result. Dropping
    // this branch schedules the key it made for deletion, so it is a per-stack decision.
    if (keys && keys.dynamodb) {
        result['dynamodb'] = CreateKey(keys.dynamodb, `${projectName}-dynamodb-data-encryption`, environment, {})
    }

    for (const key in keys) {
        if (keys.hasOwnProperty(key)) {
            const keyItem = keys[key];
            result[key] = CreateKey(keyItem, `${projectName}-${keyItem?.name}`, environment, keyItem?.options ?? {})
        }
    }

    for (const key in keysRef) {
        if (keysRef.hasOwnProperty(key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref key with the same name of an existing key: ${key}`)
            }
            const keyItem = keysRef[key];

            if (isResultItem(keyItem)) {
                result[key] = keyItem
            } else if (isKeyReferenceDefinition(keyItem)) {
                result[key] = {
                    awsKmsKey: aws.kms.Key.get(`${key}-${environment}`, keyItem.id),
                    definition: { name: key, envKeyName: keyItem.envKeyName }
                }
            } else if (keyItem) {
                result[key] = {
                    awsKmsKey: findKey(keyItem.name, environment),
                    definition: keyItem
                }
            } else {
                throw new Error(`Cannot create ref key: ${key}`)
            }
        }
    }

    return result
}

export type SecurityResultItem = {
    awsKmsKey: aws.kms.Key
    definition: SecurityKeyItem
} | undefined

export type SecurityResult = {
    [id: string]: SecurityResultItem
    dynamodb?: SecurityResultItem
}

/**
 * The key a table or topic encrypts with, named by its key in the merged result the way a secret's
 * `encryptionKeyName` already is.
 *
 * A missing name joins the other diagnostics so a stack reports all of them at once, and throws only
 * for a caller that passes none, as `requireItem` does.
 */
export const encryptionKeyFor = (
    kmsKeys: SecurityResult | undefined,
    ask: { kind: string, owner: string, encryptionKeyName?: string, legacyDynamodbFallback?: boolean },
    diagnostics?: LambadaDiagnostics
): aws.kms.Key | undefined => {
    if (ask.encryptionKeyName === undefined) {
        return ask.legacyDynamodbFallback ? kmsKeys?.dynamodb?.awsKmsKey : undefined
    }

    const item = kmsKeys?.[ask.encryptionKeyName]

    if (item) return item.awsKmsKey

    const missing = {
        functionName: `${ask.kind} '${ask.owner}'`,
        kind: 'kmsKey',
        name: ask.encryptionKeyName,
        available: Object.keys(kmsKeys ?? {}),
    }

    if (!diagnostics) {
        throw new Error(
            `Resource not found: ${missing.functionName} encrypts with kmsKey '${missing.name}', which is ` +
            `absent from the stack. The stack has: ${missing.available.join(', ') || 'none'}.`
        )
    }

    diagnostics.missingResource(missing)

    return undefined
}
