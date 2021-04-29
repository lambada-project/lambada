import { Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import * as pulumi from "@pulumi/pulumi";
import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { createLambda, FolderLambda, LambdaResource } from '../lambdas';
import { LambadaResources } from '../context';
import { Callback } from '@pulumi/aws/lambda';
import { PolicyStatement } from "@pulumi/aws/iam";
import { AuthExecutionContext, getContext } from '@lambada/utils';
import { EmbroideryEnvironmentVariables } from '..';
import { UserPool } from '@pulumi/aws/cognito';
import { LambdaAuthorizer } from '@pulumi/awsx/apigateway';
import { getNameFromPath } from './utils';
import { getCorsHeaders } from '@lambada/utils';


export type EmbroideryRequest = {
    user?: AuthExecutionContext
    request: Request
}

export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route
export type LambadaEndpointArgs = {
    /** Custom name for your lambda, if empty it will take a name based on the path-verb */
    name?: string,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    environmentVariables?: EmbroideryEnvironmentVariables,
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
    }
}

const isResponse = (result: any): boolean => {
    return result && (
        result.body && result.statusCode
    )
}

export const createEndpointSimpleCors = <T>(
    name: string,
    embroideryContext: LambadaResources,
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
    context: LambadaResources,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
    },
) => createEndpointSimpleCompat({
    name,
    path,
    method,
    callbackDefinition,
    resources,
    extraHeaders,
    auth,
    environmentVariables: undefined
}, context)

export const createEndpointSimpleCompat = ({
    name,
    path,
    method,
    callbackDefinition,
    resources,
    extraHeaders,
    auth,
    environmentVariables
}: LambadaEndpointArgs, context: LambadaResources,) => {

    const lambdaName = name ?? getNameFromPath(`${context.projectName}-${path}-${method.toLowerCase()}`)
    const newCallback = async (request: Request): Promise<Response> => {
        extraHeaders = { ...getCorsHeaders(request.requestContext.domainName, context.api?.cors?.origins), ...(extraHeaders ?? {}) }
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
            console.error(ex)
            const showErrorDetails = ex && (ex.showError || process.env['LAMBADA_SHOW_ALL_ERRORS'] == 'true')
            if (showErrorDetails) {
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        //TODO: LEGACY, MIGRATE TO ERROR OR ERRORS 
                        message: ex.message ?? ex.errorMessage,
                        code: ex.code ?? ex.errorCode,

                        error: {
                            message: ex.message ?? ex.errorMessage,
                            code: ex.code ?? ex.errorCode
                        },

                        errors: [
                            {
                                message: ex.message ?? ex.errorMessage,
                                code: ex.code ?? ex.errorCode
                            }
                        ]
                    }),
                    headers: (extraHeaders || {})
                }
            } else {
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        error: 'Bad Request'
                    }),
                    headers: (extraHeaders || {})
                }
            } ``
        }

    }

    return createEndpoint(lambdaName, context, path, method, newCallback, [], environmentVariables, auth?.useCognitoAuthorizer, resources, auth?.useApiKey)
}

export const createEndpoint = (
    name: string,
    embroideryContext: LambadaResources,
    path: string,
    method: "GET" | "POST" | "DELETE" | "OPTIONS",
    callbackDefinition: Callback<Request, Response> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth = true,
    resources?: LambdaResource[],
    apiKeyRequired?: boolean,
    lambdaAuthorizer?: LambdaAuthorizer
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

    let auth = []
    if (lambdaAuthorizer)
        auth.push(lambdaAuthorizer)
    if (embroideryContext?.api?.auth?.useCognitoAuthorizer === true || enableAuth)
        auth = [...auth, ...(embroideryContext.authorizers ?? [])]

    return {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: auth,
        eventHandler: callback,
        apiKeyRequired: embroideryContext?.api?.auth?.useApiKey === true || apiKeyRequired
    }
}