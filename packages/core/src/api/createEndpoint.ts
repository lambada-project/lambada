import { Request, Response, Route } from '@pulumi/awsx/classic/apigateway/api'
import * as aws from "@pulumi/aws";
import * as pulumi from '@pulumi/pulumi'
import { createLambda, FolderLambda, FunctionVpcConfig, LambdaOptions, LambdaResource } from '../lambdas';
import { LambadaResources } from '../context';
import { Callback } from '@pulumi/aws/lambda';
import { PolicyStatement } from "@pulumi/aws/iam";
import { AuthExecutionContext } from '@lambada/utils';
import { EmbroideryEnvironmentVariables } from '..';
import { CognitoAuthorizer, LambdaAuthorizer, Method } from '@pulumi/awsx/classic/apigateway';
import { getNameFromPath } from './utils';
import { createWebhook } from './createWebhook';
import { createCallback } from './callbackWrapper';
import { QueueArgs } from '@pulumi/aws/sqs';
import { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';

export type EmbroideryRequest = {
    user?: AuthExecutionContext
    request: Request
}

export type DistributiveOmit<T, K extends keyof T> = T extends any ? Omit<T, K> : never
export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route
export type LambadaEndpointArgs = {
    /** Custom name for your lambda, if empty it will take a name based on the path-verb */
    name?: string,
    path: string,
    method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    environmentVariables?: EmbroideryEnvironmentVariables,
    openapi?: (registry: OpenAPIRegistry) => DistributiveOmit<RouteConfig, 'path' | 'method'>
    webhook?: {
        wrapInQueue: boolean,
        options?: QueueArgs,
        /**
         * If empty, it will set a default static value
         */
        messageGroupId?: {
            field: string
            source: "BODY"// | "PATH"
        }
    },
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
    },
    options?: LambdaOptions
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
    options?: LambdaOptions,
) => {
    return createEndpointSimple(name, embroideryContext, path, method, callbackDefinition, resources,
        {
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
        },
        auth,
        options
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
    options?: LambdaOptions
) => createEndpointSimpleCompat({
    name,
    path,
    method,
    callbackDefinition,
    resources,
    extraHeaders,
    auth,
    environmentVariables: undefined,
    options
}, context)

export const createEndpointSimpleCompat = (args: LambadaEndpointArgs, context: LambadaResources): EmbroideryEventHandlerRoute => {
    args.name = args.name ?? getNameFromPath(`${context.projectName}-${args.path}-${args.method.toLowerCase()}`)

    const {
        name,
        path,
        method,
        callbackDefinition,
        resources,
        extraHeaders,
        auth,
        environmentVariables,
        options,
        webhook,
    } = args

    if (webhook?.wrapInQueue) {
        return createWebhook(args, context)
    }

    else {
        return createEndpoint<Request, Response>(
            name, context,
            path, method, createCallback({ callbackDefinition, context, extraHeaders }), [],
            environmentVariables, auth?.useCognitoAuthorizer,
            resources,
            auth?.useApiKey,
            auth?.lambdaAuthorizer,
            options
        )
    }
}

export type LambadaEndpointResult<E, R> = {
    path: string,
    method: Method,
    authorizers: (LambdaAuthorizer | CognitoAuthorizer)[],
    eventHandler: aws.lambda.EventHandler<E, R>
    apiKeyRequired: boolean | undefined
}

export const createEndpoint = <E, R>(
    name: string,
    embroideryContext: LambadaResources,
    path: string,
    method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH" | "OPTIONS",
    callbackDefinition: Callback<E, R> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth = true,
    resources?: LambdaResource[],
    apiKeyRequired?: boolean,
    lambdaAuthorizer?: LambdaAuthorizer,
    options?: LambdaOptions
): LambadaEndpointResult<E, R> => {

    var environment = embroideryContext.environment
    resources = resources || []

    if (!policyStatements) {
        policyStatements = []
    }

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

    const callback = createLambda<E, R>(
        name,
        environment,
        callbackDefinition,
        policyStatements,
        envVars,
        resources,
        undefined,
        {
            ...options,
            vpcConfig: options?.vpcConfig ?? embroideryContext.api?.vpcConfig
        }
    )

    let auth: (CognitoAuthorizer | LambdaAuthorizer)[] = []

    if (lambdaAuthorizer)
        auth.push(lambdaAuthorizer)
    else if (typeof enableAuth === 'boolean' ? enableAuth : embroideryContext?.api?.auth?.useCognitoAuthorizer === true)
        auth = [...auth, ...(embroideryContext.authorizers ?? [])]

    return {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: auth,
        eventHandler: callback,
        apiKeyRequired: typeof apiKeyRequired === 'boolean' ? apiKeyRequired : embroideryContext?.api?.auth?.useApiKey === true
    }
}