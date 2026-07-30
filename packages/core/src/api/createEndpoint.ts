import { Request, Response, Route } from '@pulumi/awsx/classic/apigateway/api'
import * as aws from "@pulumi/aws";
import { createLambda, LambdaFolder, LambdaOptions, LambdaResource } from '../lambdas';
import { LambadaResources } from '../context';
import { Callback } from '@pulumi/aws/lambda';
import { AuthExecutionContext, toWrapperEnvVars } from '@lambada/utils';
import { EmbroideryEnvironmentVariables } from '..';
import { CognitoAuthorizer, LambdaAuthorizer, Method } from '@pulumi/awsx/classic/apigateway';
import { getNameFromPath } from './utils';
import { createWebhook } from './createWebhook';
import { createCallback, toWrapperConfig } from './callbackWrapper';
import { QueueArgs } from '@pulumi/aws/sqs';
import { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';




export type EmbroideryRequest = {
    user?: AuthExecutionContext
    request: Request
    context: aws.lambda.Context
}

export type DistributiveOmit<T, K extends keyof T> = T extends any ? Omit<T, K> : never
export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route
export type LambadaEndpointArgs = {
    /** Custom name for your lambda, if empty it will take a name based on the path-verb */
    name?: string,
    path: string,
    method: HTTP_METHODS,
    /**
     * Deploy a pre-built bundle instead of a Pulumi-serialized closure: the folder to upload and the
     * `file.export` to invoke. `callbackDefinition` is ignored when this is set — the handler comes from
     * the bundle — but is still required, so an endpoint can carry both and fall back when no bundle was
     * built for it.
     *
     * Building is the service's job (its own build step), not Pulumi's: an artifact on disk keeps
     * `pulumi preview` pure and the upload reproducible.
     */
    useBundle?: LambdaFolder,
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    cache?: {
        control?: string
    },
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
    options?: LambdaOptions,
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
    else if (args.useBundle) {
        // The bundle cannot capture a Pulumi closure, so the wrapper config travels as env vars.
        return createEndpoint<Request, Response>(
            name, context,
            path, method, args.useBundle, [],
            {
                ...(environmentVariables ?? {}),
                ...toWrapperEnvVars(toWrapperConfig({ context, extraHeaders, options, cacheControl: args.cache?.control }))
            },
            auth?.useCognitoAuthorizer,
            resources,
            auth?.useApiKey,
            auth?.lambdaAuthorizer,
            options
        )
    }
    else {
        return createEndpoint<Request, Response>(
            name, context,
            path, method, createCallback({ callbackDefinition, context, extraHeaders, options, cacheControl: args.cache?.control }), [],
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
export type HTTP_METHODS = "GET" | "POST" | "DELETE" | "PUT" | "PATCH" | "OPTIONS" | "HEAD" | "ANY"
export const createEndpoint = <E, R>(
    name: string,
    lambadaContext: LambadaResources,
    path: string,
    method: HTTP_METHODS,
    callbackDefinition: Callback<E, R> | LambdaFolder,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth = true,
    resources?: LambdaResource[],
    apiKeyRequired?: boolean,
    lambdaAuthorizer?: LambdaAuthorizer,
    options?: LambdaOptions
): LambadaEndpointResult<E, R> => {

    var environment = lambadaContext.environment
    resources = resources || []

    if (!policyStatements) {
        policyStatements = []
    }

    if (lambadaContext.kmsKeys && lambadaContext.kmsKeys.dynamodb) {
        resources.push(
            {
                kmsKey: lambadaContext.kmsKeys.dynamodb,
                access: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey"
                ],
            })
    }

    const envVars = { ...(lambadaContext.environmentVariables || {}), ...(environmentVariables || {}) }

    const callback = createLambda<E, R>(
        name,
        environment,
        callbackDefinition,
        policyStatements,
        envVars,
        resources,
        undefined,
        mergeOptions(options, lambadaContext.api?.lambdaOptions),
        `${lambadaContext.projectName} ${method} ${path}`,
        lambadaContext.globalTags
    )

    let auth: (CognitoAuthorizer | LambdaAuthorizer)[] = []

    if (lambdaAuthorizer)
        auth.push(lambdaAuthorizer)
    else if (typeof enableAuth === 'boolean' ? enableAuth : lambadaContext?.api?.auth?.useAuthorizers === true)
        auth = [...auth, ...(lambadaContext.authorizers ?? [])]

    return {
        path: `${lambadaContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: auth,
        eventHandler: callback,
        apiKeyRequired: typeof apiKeyRequired === 'boolean' ? apiKeyRequired : lambadaContext?.api?.auth?.useApiKey === true
    }
}



export function mergeOptions(lambdaOptions: LambdaOptions | undefined, globalOptions: LambdaOptions | undefined): LambdaOptions {
    return {
        memorySize: lambdaOptions?.memorySize ?? globalOptions?.memorySize,
        vpcConfig: lambdaOptions?.vpcConfig ?? globalOptions?.vpcConfig,
        architecture: lambdaOptions?.architecture ?? globalOptions?.architecture,
        callbackWaitsForEmptyEventLoop: lambdaOptions?.callbackWaitsForEmptyEventLoop ?? globalOptions?.callbackWaitsForEmptyEventLoop,
        reservedConcurrentExecutions: lambdaOptions?.reservedConcurrentExecutions ?? globalOptions?.reservedConcurrentExecutions,
        runtime: lambdaOptions?.runtime ?? globalOptions?.runtime,
        timeout: lambdaOptions?.timeout ?? globalOptions?.timeout,
        layers: lambdaOptions?.layers ?? globalOptions?.layers,
        enableXRay: lambdaOptions?.enableXRay ?? globalOptions?.enableXRay,
    }
}

