import * as pulumi from '@pulumi/pulumi'
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { CallbackFunction } from '@pulumi/aws/lambda';
import { ManagedPolicies } from '@pulumi/aws/iam/managedPolicies'
import { PolicyDocument, PolicyStatement } from '@pulumi/aws/iam/documents'
import { logsStatement, LambdaResourceAccess } from '../lambdas';
import { DatabaseResultItem } from '../database';
import { SecurityResult } from '../security';

export type CreatedLambdaItem = {
    callback: CallbackFunction<any, void>,
    role: aws.iam.Role
}
export type CreatedLambdas = {
    postConfirmation: CreatedLambdaItem
}

export function createAuthLambdas(environment: string, userAccountTable: DatabaseResultItem): CreatedLambdas {

    const policy: PolicyDocument = {
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

    const role = new aws.iam.Role(`postconfirmation-lambda-role-${environment}`, {
        assumeRolePolicy: policy,
    })

    const postConfirmation = new aws.lambda.Function(`postConfirmation-${environment}`, {
        runtime: aws.lambda.NodeJS12dXRuntime,
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive("./auth/lambdas/src/dist"),
        }),
        //code: new pulumi.asset.FileAsset('./auth/lambdas/postConfirmation.js'),
        timeout: 5,
        //THE CONTENT OF DIST 1:1 
        handler: "./auth/lambdas/src/postConfirmation.main",
        role: role.arn,
        environment: {
            variables: {
                [userAccountTable.definition.envKeyName]: userAccountTable.ref.name
            }
        }
    });

    return {
        postConfirmation: {
            callback: postConfirmation,
            role: role
        }
    }
}

export function attachPolicies(environment: string, lambdas: CreatedLambdas, userpool: aws.cognito.UserPool, userAccountTable: DatabaseResultItem, kmsKeys?: SecurityResult): void {

    const statements: pulumi.Input<pulumi.Input<PolicyStatement>[]> = [
        logsStatement,
        {
            Action: [
                "cognito-idp:AdminUpdateUserAttributes",
                "cognito-idp:AdminGetUser",
                "cognito-idp:ListUsers"
            ],
            Resource: userpool.arn,
            Effect: "Allow"
        },
        {
            Action: [
                LambdaResourceAccess.DynamoDbGetItem,
                LambdaResourceAccess.DynamoDbUpdateItem
            ],
            Resource: userAccountTable.ref.arn,
            Effect: 'Allow'
        }
    ]

    if (kmsKeys?.dynamodb) {
        statements.push(
            {
                Resource: kmsKeys.dynamodb.awsKmsKey.arn,
                Action: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey"
                ],
                Effect: 'Allow'
            }
        )
    }

    const logsPolicy = new aws.iam.Policy(`postconfirmation-policy-${environment}`, {
        path: "/",
        policy: {
            Version: "2012-10-17",
            Statement: statements
        }

    })

    new aws.iam.RolePolicyAttachment(`postconfirmation-policy-attachment-${environment}`, {
        policyArn: logsPolicy.arn,
        role: lambdas.postConfirmation.role
    })
}