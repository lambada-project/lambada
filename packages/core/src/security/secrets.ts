import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx/classic"
import { EmbroideryEncryptionKeys } from "."


export type SecretDefinition = {
    name: string
    envKeyName: string
    encryptionKeyName?: string
}
export type EmbroiderySecrets = { [id: string]: SecretDefinition }

export function createSecret(projectName: string, environment: string, secret: SecretDefinition, keys?: EmbroideryEncryptionKeys) {
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

export function createSecrets(projectName: string, environment: string, secrets: EmbroiderySecrets, keys?: EmbroideryEncryptionKeys): SecretsResult {
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

    return result;
}

export type SecretResultItem = {
    awsSecret: aws.secretsmanager.Secret
    definition: SecretDefinition
    //kmsKey: aws.kms.Key
}
export type SecretsResult = { [id: string]: SecretResultItem }
