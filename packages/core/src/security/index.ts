import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import { KeyArgs } from '@pulumi/aws/kms/key.d'
export * from './secrets'

type KeyParams = Omit<KeyArgs, "tags" | 'description'>

/** What every reader needs, whichever way the key was given. */
export type KeyReference = {
    id: pulumi.Input<string>
    arn: pulumi.Input<string>
}

/** A key outside the naming convention, addressed by value the way a referenced pool is. */
export type KeyReferenceDefinition = KeyReference & {
    envKeyName: string
}

export const keyName = (projectName: string, name: string, environment: string) => `${projectName}-${name}-${environment}`

/** The alias `CreateKey` gives every key it makes, and the only handle a name-based ref can use. */
export const keyAlias = (projectName: string, name: string, environment: string) =>
    `alias/${keyName(projectName, name, environment)}`

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
        name: `alias/${keyname}`,
        targetKeyId: key.keyId
    })

    return {
        awsKmsKey: key,
        ref: { id: key.keyId, arn: key.arn },
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
 * through the alias, or by value for a key outside the convention.
 */
export type SecurityKeysRef = {
    [id: string]: SecurityKeyItem | KeyReferenceDefinition
}

const isKeyReferenceDefinition = (item: SecurityKeyItem | KeyReferenceDefinition): item is KeyReferenceDefinition =>
    !!item && 'arn' in item

const isResultItem = (item: SecurityResultItem | SecurityKeyItem | KeyReferenceDefinition): item is SecurityResultItem =>
    !!item && 'ref' in item

/** The key the alias points at, not the alias itself. */
function findKey(projectName: string, name: string, environment: string): KeyReference {
    const alias = keyAlias(projectName, name, environment)
    const found = pulumi.output(aws.kms.getAlias({ name: alias }, { async: true }))

    return { id: found.targetKeyId, arn: found.targetKeyArn }
}

export function createKMSKeys(projectName: string, environment: string, keys: SecurityKeys | undefined, keysRef: SecurityKeysRef | SecurityResult | undefined): SecurityResult {
    const result: SecurityResult = {}

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
                    ref: { id: keyItem.id, arn: keyItem.arn },
                    definition: keyItem
                }
            } else if (keyItem) {
                result[key] = {
                    ref: findKey(projectName, keyItem.name, environment),
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
    /** The key itself, when this stack created it rather than referencing one. */
    awsKmsKey?: aws.kms.Key
    ref: KeyReference
    definition: SecurityKeyItem | KeyReferenceDefinition
} | undefined

export type SecurityResult = {
    [id: string]: SecurityResultItem
    dynamodb?: SecurityResultItem
}
