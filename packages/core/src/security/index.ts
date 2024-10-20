import * as aws from "@pulumi/aws"
import { KeyArgs } from '@pulumi/aws/kms/key.d'
export * from './secrets'

type KeyParams = Omit<KeyArgs, "tags" | 'description'>

export function CreateKey(item: EncryptionKeyItem, name: string, environment: string, args: KeyParams): SecurityResultItem {
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

export type EncryptionKeyItem = {
    name: string
    envKeyName: string
    options?: KeyParams
} | undefined

export type EmbroideryEncryptionKeys = {
    [id: string]: EncryptionKeyItem
    dynamodb?: EncryptionKeyItem
}


export function CreateKMSKeys(projectName: string, environment: string, keys: EmbroideryEncryptionKeys): SecurityResult {
    const result: SecurityResult = {
        dynamodb: keys.dynamodb ? CreateKey(keys.dynamodb, `${projectName}-dynamodb-data-encryption`, environment, {}) : undefined
    }

    for (const key in keys) {
        if (keys.hasOwnProperty(key)) {
            const keyItem = keys[key];
            result[key] = CreateKey(keyItem, `${projectName}-${keyItem?.name}`, environment, keyItem?.options ?? {})
        }
    }
    return result
}

export type SecurityResultItem = {
    awsKmsKey: aws.kms.Key
    definition: EncryptionKeyItem
} | undefined

export type SecurityResult = {
    [id: string]: SecurityResultItem
    dynamodb?: SecurityResultItem
}