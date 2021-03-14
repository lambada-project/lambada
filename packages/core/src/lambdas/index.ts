import * as pulumi from '@pulumi/pulumi'
import * as aws from "@pulumi/aws";
import { Callback } from '@pulumi/aws/lambda';

import { PolicyDocument, PolicyStatement } from "@pulumi/aws/iam";
import { DatabaseResultItem } from '../database';
//import { MessagingResultItem } from '../messaging';
import { SecretResultItem, SecurityResultItem } from '../security';
import { MessagingResultItem } from '../messaging';
import { NotificationResult } from '../notifications';
import { EmbroideryEnvironmentVariables } from '..';
//import { NotificationResult, NotificationResultItem } from '../notifications';

export const lambdaAsumeRole: PolicyDocument = {
    Version: "2012-10-17",
    Statement: [
        {
            Action: ["sts:AssumeRole"],
            Principal: {
                Service: "lambda.amazonaws.com"
            },
            Effect: "Allow",
        }
    ]
}

export const logsStatement: PolicyStatement = {
    Effect: "Allow",
    "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
    ],
    "Resource": "arn:aws:logs:*:*:*"
};

export type FolderLambda = {
    /**
     * Handler directory location
     */
    functionFolder: string
    /**
     * File.Export
     */
    handler: string
}
export const createLambda = <E, R>(
    name: string,
    environment: string,
    definition: Callback<E, R> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables,
    resources: LambdaResource[],
    overrideRole?: aws.iam.Role
): aws.lambda.EventHandler<E, R> => {

    let lambdaRole = overrideRole
    const createRole = lambdaRole ? false : true

    if (!policyStatements) policyStatements = []
    if (!environmentVariables) environmentVariables = {}

    var envVarsFromResources: EmbroideryEnvironmentVariables = {}
    //pulumi.log.info('resources length:' + resources.length)
    for (let i = 0; i < resources.length; i++) {
        const access = resources[i];

        if (access.access.length === 0) {
            throw new Error(`Resource on ${name} has zero access request`)
        }
        if (access.table) {
            //pulumi.log.info('granting access to table' + access.table.definition.name)
            //DB connections need the table name to talk to DynamoDB
            envVarsFromResources[access.table.definition.envKeyName] = access.table.ref.name
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.table.ref.arn,
                    Effect: 'Allow'
                }
            )
        }
        else if (access.topic) {
            //PubSub connections need the topic ARN to talk to SNS
            envVarsFromResources[access.topic.envKeyName] = access.topic.ref.arn
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.topic.ref.arn,
                    Effect: 'Allow'
                }
            )
        }
        else if (access.notification) {
            //PubSub connections need the topic ARN to send push notifications
            //envVarsFromResources[access.notification.gcm.] = access.notification.gcm
            if (access.notification.gcm) {
                policyStatements.push(
                    {
                        Action: access.access,
                        Resource: access.notification.gcm.application.arn,
                        Effect: 'Allow'
                    }
                )
            }
            else {
                throw new Error('other notification system than GCM is not implemented')
            }
        }
        else if (access.secret) {
            //PubSub connections need the topic ARN to talk to SNS
            envVarsFromResources[access.secret.definition.envKeyName] = access.secret.awsSecret.name
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.secret.awsSecret.arn,
                    Effect: 'Allow'
                }
            )
        }
        else if (access.kmsKey) {
            if (access.kmsKey.definition)
                envVarsFromResources[access.kmsKey.definition.envKeyName] = access.kmsKey.awsKmsKey.arn
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.kmsKey.awsKmsKey.arn,
                    Effect: 'Allow'
                }
            )
            // const keyname = access.kmsKey.name

            // new aws.kms.Grant(`KMS-grant-${keyname}`, {
            //         granteePrincipal: lambdaRole.arn,
            //         keyId: access.kmsKey.awsKmsKey.keyId,
            //         operations: [
            //             "Encrypt",
            //             "Decrypt",
            //             "GenerateDataKey",
            //                 // "kms:Encrypt",
            //                 // "kms:Decrypt",
            //                 // "kms:ReEncrypt*",
            //                 // "kms:GenerateDataKey*",
            //                 // "kms:DescribeKey"
            //         ]
            //     })
        }
        else if (access.arn) {
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.arn,
                    Effect: 'Allow'
                }
            )
        }
        else {
            throw 'Access must have the resource, eg. topic, table, messaging, etc. ' + JSON.stringify(access)
        }
    }

    if (createRole) {
        lambdaRole = createLambdaRoleAndPolicies(name, environment, policyStatements)
    }

    const variables = {
        ...envVarsFromResources,
        ...environmentVariables
    }

    //NOTE: for some reason, it cannot be a empty object, so we need to see how many keys the object has, if zero then pass undefined
    const hasKeys = Object.keys(variables).length > 0
    const functionEnvironment = hasKeys ? {
        variables
    } : undefined

    const memorySize = 768

    if (typeof definition === 'function') {
        console.log("FUNCTION")
        const callbackDefinition = definition as Callback<E, R>
        return new aws.lambda.CallbackFunction(`${name}-${environment}`, {
            callback: callbackDefinition,
            role: lambdaRole,
            description: `Lambda ${name} - ${environment}`,
            environment: functionEnvironment,
            memorySize: memorySize
        })
    }
    else if ((definition as FolderLambda).functionFolder) {
        console.log("FOLDER")
        if (lambdaRole) {
            const handlerInfo = (definition as FolderLambda)

            return new aws.lambda.Function(`${name}-${environment}`, {
                runtime: aws.lambda.Runtime.NodeJS12dX,
                code: new pulumi.asset.AssetArchive({
                    ".": new pulumi.asset.FileArchive(
                        handlerInfo.functionFolder
                        //`./auth/lambdas/src/dist`
                    ),
                }),
                memorySize: memorySize,
                //code: new pulumi.asset.FileAsset('./auth/lambdas/postConfirmation.js'),
                timeout: 5,
                //THE CONTENT OF DIST 1:1 
                handler: handlerInfo.handler, //"./auth/lambdas/src/index.main",
                role: lambdaRole.arn,
                layers: [],
                environment: functionEnvironment // TODO:
            });
        }
        else {
            throw Error(`No role for the lambda ${name} was specifed`)
        }
    }
    else {
        pulumi.log.error(`Invalid lambda definition: ${JSON.stringify(definition)}`)
        throw Error('Invalid lambda definition. I can only be a callback or te location of the folder to deploy')
    }
}

export const createLambdaRoleAndPolicies = (name: string, environment: string, policyStatements: aws.iam.PolicyStatement[]) => {
    let dashedNamed = name.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
    if (dashedNamed.startsWith('-')) {
        dashedNamed = dashedNamed.substr(1);
    }
    dashedNamed = `${dashedNamed}-${environment}`

    if (!policyStatements) policyStatements = []

    const role = new aws.iam.Role(`${dashedNamed}-role`, {
        assumeRolePolicy: lambdaAsumeRole,
    })

    const policy = new aws.iam.Policy(`${dashedNamed}-policy`, {
        path: "/",
        policy: {
            Version: "2012-10-17",
            Statement: [
                logsStatement,
                ...policyStatements
            ]
        }
    })

    new aws.iam.RolePolicyAttachment(`${dashedNamed}-policy-attachment`, {
        policyArn: policy.arn,
        role: role
    })

    return role
}

// export type EnvironmentVariables = pulumi.Input<{
//     [key: string]: pulumi.Input<string>
// }> | undefined



export type LambdaResourceAccessItem = string

export class LambdaResourceAccess {
    public static DynamoDbGetItem: LambdaResourceAccessItem = "dynamodb:GetItem"
    public static DynamoDbGetAsterisk: LambdaResourceAccessItem = "dynamodb:Get*"
    public static DynamoDbScan: LambdaResourceAccessItem = "dynamodb:Scan"
    public static DynamoDbQuery: LambdaResourceAccessItem = "dynamodb:Query"
    public static DynamoDbUpdateItem: LambdaResourceAccessItem = "dynamodb:UpdateItem"
    public static DynamoDbDeleteItem: LambdaResourceAccessItem = "dynamodb:DeleteItem"
    public static DynamoDbPutItem: LambdaResourceAccessItem = "dynamodb:PutItem"

}

export type LambdaDynamoDbResource = {
    table?: DatabaseResultItem
    topic?: MessagingResultItem
    notification?: NotificationResult
    kmsKey?: SecurityResultItem
    secret?: SecretResultItem
    arn?: string
    access: LambdaResourceAccessItem[]
}

export type LambdaResource = LambdaDynamoDbResource
