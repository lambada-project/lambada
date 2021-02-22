import { Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import * as pulumi from "@pulumi/pulumi";
import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { createLambda, FolderLambda, LambdaResource } from '../lambdas';
import { EmbroideryContext } from '../context';
import { Callback, CallbackFactory } from '@pulumi/aws/lambda';
import { PolicyStatement } from "@pulumi/aws/iam";
import { AuthExecutionContext, getUser, getContext, tryGetBody, getBody } from './utils';
import { EmbroideryEnvironmentVariables } from '..';
import { UserPool } from '@pulumi/aws/cognito';

export type EmbroideryRequest = {
    user?: AuthExecutionContext
    request: Request
}

export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route

const isResponse = (result: any): boolean => {
    return result && (
        result.body && result.statusCode
    )
}

export const createEndpointSimpleCors = <T>(
    name: string,
    embroideryContext: EmbroideryContext,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean
        useApiKey?: boolean
    },
) => {
    return createEndpointSimple(name, embroideryContext, path, method, callbackDefinition, resources,
        {
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
        },
        auth,
    )
}

export const createEndpointSimple = (
    name: string,
    embroideryContext: EmbroideryContext,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean
        useApiKey?: boolean
    },
) => {
    const newCallback = async (request: Request): Promise<Response> => {

        const authContext = await getContext(request)
        //const user = authContext?.currentUsername && authContext ? await getUser(authContext.currentUsername, authContext) : undefined
        try {
            const result = await callbackDefinition({
                user: authContext,
                request
            })

            if (isResponse(result)) {
                const resultTyped = result as any
                return {
                    ...resultTyped,
                    headers: {
                        ...(resultTyped.headers || {}),
                        ...(extraHeaders || {})
                    }
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify(result ?? {}),
                headers: (extraHeaders || {})
            }
            
        } catch (ex) {
            if (ex && (ex as Error).message) {
                return {
                    statusCode: 400,
                    body: ex.message,
                    headers: (extraHeaders || {})
                }
            } else {
                throw ex;
            }``
        }

    }

    return createEndpoint(name, embroideryContext, path, method, newCallback, [], undefined, auth?.useCognitoAuthorizer, resources, auth?.useApiKey)
}

export const createEndpoint = (
    name: string,
    embroideryContext: EmbroideryContext,
    path: string,
    method: "GET" | "POST" | "DELETE" | "OPTIONS",
    callbackDefinition: Callback<Request, Response> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth = true,
    resources?: LambdaResource[],
    apiKeyRequired?: boolean,
): EmbroideryEventHandlerRoute => {

    var environment = embroideryContext.environment
    resources = resources || []

    if (!policyStatements) {
        policyStatements = []
    }

    // This is not working :( somehow "Resource" is not there
    // if (embroideryContext.authorizers) {
    //     const auths = embroideryContext.authorizers
    //     pulumi.log.info(`Adding Authorizers: ${auths.length}`)

    //     for (let i = 0; i < auths.length; i++) {
    //         const providerARNs = auths[i].providerARNs.map(x=> (x as UserPool).arn  || x)
    //         pulumi.log.info(`Adding ARNS: ${providerARNs.length}`)

    //         policyStatements.push({
    //             Action: [
    //                 "cognito-idp:AdminGetUser",
    //                 "cognito-idp:ListUsers"
    //             ],
    //             Resource: providerARNs,
    //             Effect: "Allow"
    //         })
    //     }
    // }

    if (embroideryContext.kmsKeys && embroideryContext.kmsKeys.dynamodb) {
        resources.push(
            {
                kmsKey: embroideryContext.kmsKeys.dynamodb,
                access: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey"
                ],
            })
    }

    const envVars = { ...(embroideryContext.environmentVariables || {}), ...(environmentVariables || {}) }

    const callback = createLambda<Request, Response>(
        name,
        environment,
        callbackDefinition,
        policyStatements,
        envVars,
        resources
    )

    return {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: embroideryContext?.api?.auth?.useCognitoAuthorizer === true || enableAuth ? embroideryContext.authorizers : [],
        eventHandler: callback,
        apiKeyRequired: embroideryContext?.api?.auth?.useApiKey === true || apiKeyRequired
    }
}