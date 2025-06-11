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

export function createSecrets(projectName: string, environment: string, secrets: EmbroiderySecrets | undefined = {}, secretsRef?: SecretsResult | EmbroiderySecrets, keys?: SecurityKeys): SecretsResult {
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
            const secretRef = secretsRef[key];

            function isRef(obj: SecretResultItem | SecretDefinition): obj is SecretResultItem {
                return !!(obj as SecretResultItem).awsSecret
            }

            if (isRef(secretRef)) {
                result[key] = secretRef
            } else {
                const secret = findSecret(projectName, environment, secretRef, keys)

                result[key] = {
                    awsSecret: aws.secretsmanager.Secret.get(`${secretRef.name}-${environment}`, secret.id),
                    definition: secretRef
                } satisfies SecretResultItem
                throw new Error(`Cannot create ref secret: ${key}`)
            }
        }
    }

    return result;
}

function findSecret(projectName: string, environment: string, secret: SecretDefinition, keys?: SecurityKeys): pulumi.Output< {
    name: string;
    id: string;
    arn: string;
}> {
    const secretName = secret.name
    const name = `${projectName}-${secretName}-${environment}`
    const kmsKeyId = secret.encryptionKeyName && keys ? keys[secret.encryptionKeyName]?.name : undefined

    const getSecret = async (name: string) => {
        try {
            const topic = await aws.secretsmanager.getSecret({
                name: name,
            }, { async: true })
            return topic
        } catch (e) {
            console.error('Failed to get secret', name);
            throw e
        }

    }

    return pulumi.output(getSecret(name));
}

export type SecretResultItem = {
    awsSecret: aws.secretsmanager.Secret
    definition: SecretDefinition
    //kmsKey: aws.kms.Key
}
export type SecretsResult = { [id: string]: SecretResultItem }
