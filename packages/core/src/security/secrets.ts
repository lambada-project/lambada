import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx/classic"
import { SecurityKeys } from "."


export type SecretDefinition = {
    name: string
    envKeyName: string
    encryptionKeyName?: string
}
export type EmbroiderySecrets = { [id: string]: SecretDefinition }

export function createSecret(projectName: string, environment: string, secret: SecretDefinition, keys?: SecurityKeys) {
    const secretName = secret.name
    const name = `${projectName}-${secretName}-${environment}`
    const kmsKeyId = secret.encryptionKeyName && keys ? keys[secret.encryptionKeyName]?.name : undefined

    return new aws.secretsmanager.Secret(name, {
        name: name,
        kmsKeyId: kmsKeyId,
        tags: {
            Environment: environment,
            'Created by': 'Embroidery'
        }
    })
}

export function createSecrets(projectName: string, environment: string, secrets: EmbroiderySecrets | undefined = {}, secretsRef?: SecretsResult, keys?: SecurityKeys): SecretsResult {
    const result: SecretsResult = {}
    for (const key in secrets) {
        if (secrets.hasOwnProperty(key)) {
            const secret = secrets[key];
            //const kmsKey = table.name == 'userAccounts' ? kmsKeys.dynamodb : undefined

            result[key] = {
                awsSecret: createSecret(projectName, environment, secret, keys),
                definition: secret
                //kmsKey: kmsKey?.awsKmsKey
            } as SecretResultItem
        }
    }

    for (const key in secretsRef) {
        if (secretsRef.hasOwnProperty(key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref secret with the same name of an existing secret: ${key}`)
            }
            const secret = secretsRef[key];

            function isRef(obj: SecretResultItem | SecretDefinition): obj is SecretResultItem {
                return !!(obj as SecretResultItem).awsSecret
            }

            if (isRef(secret)) {
                result[key] = secret
            } else {
                // result[key] = {
                //     awsSecret: secret,
                //     definition: secret
                //     //kmsKey: kmsKeys?.dynamodb?.awsKmsKey
                // } as SecretResultItem
                throw new Error(`Cannot create ref secret: ${key}`)
            }
        }
    }

    return result;
}

export type SecretResultItem = {
    awsSecret: aws.secretsmanager.Secret
    definition: SecretDefinition
    //kmsKey: aws.kms.Key
}
export type SecretsResult = { [id: string]: SecretResultItem }
