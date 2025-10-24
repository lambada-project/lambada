import * as pulumi from '@pulumi/pulumi'
import * as aws from "@pulumi/aws";
import { Callback, Runtime } from '@pulumi/aws/lambda';
import { Input } from "@pulumi/pulumi";

import { PolicyDocument, PolicyStatement } from "@pulumi/aws/iam";
import { DatabaseResultItem } from '../database';
//import { MessagingResultItem } from '../messaging';
import { SecretResultItem, SecurityResultItem } from '../security';
import { MessagingResultItem } from '../messaging';
import { NotificationResult } from '../notifications';
import { EmbroideryEnvironmentVariables } from '..';
import { enums } from '@pulumi/aws/types';
import { QueueResultItem } from '../queue';
//import { NotificationResult, NotificationResultItem } from '../notifications';

export const lambdaAssumeRole: PolicyDocument = {
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

const VPCAccessExecutionStatement: PolicyStatement = {
    "Effect": "Allow",
    "Action": [
        "ec2:DescribeNetworkInterfaces",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeInstances",
        "ec2:AttachNetworkInterface"
    ],
    "Resource": "*"
}

//AWSXRayDaemonWriteAccess 
const AWSXRayDaemonWriteAccess: PolicyStatement = {
    "Effect": "Allow",
    "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries"
    ],
    "Resource": "*"
}


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

export type LambdaOptions = {
    /**
    * Amount of memory in MB your Lambda Function can use at runtime. Defaults to `128`. See [Limits](https://docs.aws.amazon.com/lambda/latest/dg/limits.html)
    */
    memorySize?: number

    /**
     *  Timeout in minutes 
     * */
    timeout?: pulumi.Input<number>

    /**
     * Runtime as per AWS documentation
     */
    runtime?: Runtime

    /**
     * OS Runtime Architecture as per AWS documentation
     */
    architecture?: "x8664" | "arm64"

    /**
     * The amount of reserved concurrent executions for this lambda function. A value of `0` disables lambda from being triggered and `-1` removes any concurrency limitations. Defaults to Unreserved Concurrency Limits `-1`. See [Managing Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/concurrent-executions.html) 
     * */
    reservedConcurrentExecutions?: number

    /**
     * VPC configuration associated with your Lambda function. See [VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
     * */
    vpcConfig?: Input<FunctionVpcConfig>

    /**
     * Set to false to send the response right away and not wait for the event loop to be empty
     */
    callbackWaitsForEmptyEventLoop?: boolean

    /**
     * Layers to add to the lambda
     */
    //layers?: aws.lambda.LayerVersion[]
    layers?: pulumi.Input<pulumi.Input<string>[]> | undefined

    /**
     * Enables XRay access from this lambda
     */
    enableXRay?: pulumi.Input<boolean>
}

export const createLambda = <E, R>(
    name: string,
    environment: string,
    definition: Callback<E, R> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables,
    resources: LambdaResource[],
    overrideRole?: aws.iam.Role,
    options?: LambdaOptions,
    description?: string,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
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

            if (access.table.definition.indexes?.length) {
                policyStatements.push(
                    {
                        Action: access.access,
                        Resource: pulumi.interpolate`${access.table.ref.arn}/index/*`,
                        Effect: 'Allow'
                    }
                )
            }

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
        else if (access.queue) {
            //PubSub connections need the topic ARN to talk to SNS
            envVarsFromResources[access.queue.envKeyName] = access.queue.ref.url ?? access.queue.awsQueue.url
            policyStatements.push(
                {
                    Action: access.access,
                    Resource: access.queue.ref.arn,
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
            throw name + '-' + environment + ': Access must have the resource, eg. topic, table, messaging, etc. ' + JSON.stringify(access);
        }
    }

    if (options?.vpcConfig) {
        policyStatements.push(VPCAccessExecutionStatement)
    }

    if (options?.enableXRay) {
        policyStatements.push(AWSXRayDaemonWriteAccess)
    }

    if (createRole) {
        lambdaRole = createLambdaRoleAndPolicies(name, environment, policyStatements)
    }

    const variables = {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        ...envVarsFromResources,
        ...environmentVariables
    }

    //NOTE: for some reason, it cannot be a empty object, so we need to see how many keys the object has, if zero then pass undefined
    const hasKeys = Object.keys(variables).length > 0
    const functionEnvironment = hasKeys ? {
        variables
    } : undefined

    // TODO: This should be exposed per lambda and as global defaults
    const memorySize = options?.memorySize ?? 512
    const timeout = options?.timeout ?? 90
    const reservedConcurrentExecutions = options?.reservedConcurrentExecutions ?? -1
    const runtime = options?.runtime ?? aws.lambda.Runtime.NodeJS22dX
    const architectures = options?.architecture ? [options?.architecture] : undefined
    const layers = options?.layers

    const _vpcConfig = options?.vpcConfig ?? {
        securityGroupIds: [],
        subnetIds: []
    }

    description = description ?? `${name}-${environment}`

    if (typeof definition === 'function') {
        const callbackDefinition = definition as Callback<E, R>
        return new aws.lambda.CallbackFunction(`${name}-${environment}`, {
            callback: callbackDefinition,
            role: lambdaRole,
            description: description,
            environment: functionEnvironment,
            memorySize: memorySize,
            timeout: timeout,
            reservedConcurrentExecutions: reservedConcurrentExecutions,
            runtime: runtime,
            architectures: architectures,
            vpcConfig: _vpcConfig,
            tags: tags,
            layers: layers
        })
    }
    else if ((definition as FolderLambda).functionFolder) {
        if (lambdaRole) {
            const handlerInfo = (definition as FolderLambda)

            return new aws.lambda.Function(`${name}-${environment}`, {
                runtime: runtime,
                architectures: architectures,
                description: description,
                code: new pulumi.asset.AssetArchive({
                    ".": new pulumi.asset.FileArchive(
                        handlerInfo.functionFolder
                        //`./auth/lambdas/src/dist`
                    ),
                }),
                memorySize: memorySize,
                //code: new pulumi.asset.FileAsset('./auth/lambdas/postConfirmation.js'),
                timeout: timeout,
                //THE CONTENT OF DIST 1:1 
                handler: handlerInfo.handler, //"./auth/lambdas/src/index.main",
                role: lambdaRole.arn,
                layers: layers,
                environment: functionEnvironment, // TODO:
                reservedConcurrentExecutions: reservedConcurrentExecutions,
                vpcConfig: _vpcConfig,
                tags: tags
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
        name: `${dashedNamed}-role`,
        assumeRolePolicy: lambdaAssumeRole,
    })
    //aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole
    const policy = new aws.iam.Policy(`${dashedNamed}-policy`, {
        name: `${dashedNamed}-policy`,
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
    public static SNSPublish: LambdaResourceAccessItem = "sns:Publish"
}

export type LambdaDynamoDbResource = {
    table?: DatabaseResultItem
    topic?: MessagingResultItem
    queue?: QueueResultItem
    notification?: NotificationResult
    kmsKey?: SecurityResultItem
    secret?: SecretResultItem
    arn?: Input<string> | Input<Input<string>[]>
    access: LambdaResourceAccessItem[]
}

export type LambdaResource = LambdaDynamoDbResource

export type FunctionVpcConfig = {
    /**
     * List of security group IDs associated with the Lambda function.
     */
    securityGroupIds: pulumi.Input<pulumi.Input<string>[]>;
    /**
     * List of subnet IDs associated with the Lambda function.
     */
    subnetIds: pulumi.Input<pulumi.Input<string>[]>;
}
