import * as aws from "@pulumi/aws"
import { KeyArgs } from '@pulumi/aws/kms/key.d'
export * from './secrets'

type KeyParams = Omit<KeyArgs, "tags" | 'description'>

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


export function createKMSKeys(projectName: string, environment: string, keys: SecurityKeys | undefined, keysRef: SecurityResult | undefined): SecurityResult {
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

            function isRef(obj: SecurityResultItem | SecurityKeyItem): obj is SecurityResultItem {
                if (!obj) return false
                return !!(obj as SecurityResultItem)?.awsKmsKey
            }

            if (isRef(keyItem)) {
                result[key] = keyItem
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