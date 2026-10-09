import { Request, Response, Route } from '@pulumi/awsx/classic/apigateway/api'
import * as aws from "@pulumi/aws";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas';
import { bundleOf } from '../lambdas/bundles';
import { LambadaResources } from '../context';
import { LambadaResourceRequest, LambadaGrantsShape, resolveEnvironment, resolveGrants } from '../resources/grants';
import { AuthExecutionContext, toWrapperEnvVars } from '@lambada/utils';
import { EmbroideryEnvironmentVariables } from '..';
import { CognitoAuthorizer, LambdaAuthorizer, Method } from '@pulumi/awsx/classic/apigateway';
import { getNameFromPath } from './utils';
import { AuthorizerSelection, styleProblems } from '../auth/authorizers';
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

export type OpenApiFactory = (registry: OpenAPIRegistry) => DistributiveOmit<RouteConfig, 'path' | 'method'>

/** Constrains the shape, not the vocabulary, so a declaration can bring its own spec types. */
export type OpenApiFactoryLike = (...args: never[]) => unknown
export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route
export type LambadaEndpointArgs<
    TNames extends LambadaGrantsShape = LambadaGrantsShape,
    TOpenApi extends OpenApiFactoryLike | undefined = OpenApiFactory
> = {
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
    resources?: LambadaResourceRequest<TNames>,
    extraHeaders?: {},
    cache?: {
        control?: string
    },
    environmentVariables?: EmbroideryEnvironmentVariables,
    /**
     * Read only by the document endpoint, which narrows it back. Defaults to the classic factory so
     * an un-annotated `registry` is still typed; name a factory type to bring another vocabulary.
     */
    openapi?: TOpenApi
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
        /** @deprecated Select an authorizer by name with `authorizer`. */
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        /** @deprecated Declare it in run()'s `auth.authorizers` and select it by name. */
        lambdaAuthorizer?: LambdaAuthorizer
        /** A name from run()'s `auth.authorizers`, or `false` for public. Left out, the stack default. */
        authorizer?: AuthorizerSelection
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
    resources?: LambadaResourceRequest<any>,
    extraHeaders?: {},
    /** This overrides at endpoint level any default set */
    auth?: {
        /** @deprecated Select an authorizer by name with `authorizer`. */
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        /** @deprecated Declare it in run()'s `auth.authorizers` and select it by name. */
        lambdaAuthorizer?: LambdaAuthorizer
        /** A name from run()'s `auth.authorizers`, or `false` for public. Left out, the stack default. */
        authorizer?: AuthorizerSelection
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

export const createEndpointSimpleCompat = (args: LambadaEndpointArgs<any, any>, context: LambadaResources): EmbroideryEventHandlerRoute => {
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
    const mixed = styleProblems(context.authorization, name, auth)
    if (mixed.length > 0) throw new Error(mixed.join('\n'))

    const useBundle = args.useBundle ?? bundleOf(context.bundles, name)

    if (webhook?.wrapInQueue) {
        // No bundle: the lambda behind the queue is lambada's glue, not this callback, so an
        // artifact built from the declaration would receive the raw SQS event.
        return createWebhook(args, context)
    }
    else if (useBundle) {
        // The bundle cannot capture a Pulumi closure, so the wrapper config travels as env vars.
        return createEndpoint<Request, Response>(
            name, context,
            path, method, useBundle, [],
            {
                ...(environmentVariables ?? {}),
                ...toWrapperEnvVars(toWrapperConfig({ context, extraHeaders, options, cacheControl: args.cache?.control }))
            },
            auth?.useCognitoAuthorizer,
            resources,
            auth?.useApiKey,
            auth?.lambdaAuthorizer,
            options,
            auth?.authorizer
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
            options,
            auth?.authorizer
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
    callbackDefinition: LambdaHandler<E, R> | LambdaFolder,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth?: boolean,
    resources?: LambadaResourceRequest<any>,
    apiKeyRequired?: boolean,
    lambdaAuthorizer?: LambdaAuthorizer,
    options?: LambdaOptions,
    authorizer?: AuthorizerSelection
): LambadaEndpointResult<E, R> => {
    // A creator may call this directly, past the check on declared endpoints.
    const mixed = styleProblems(lambadaContext.authorization, name, { useCognitoAuthorizer: enableAuth, lambdaAuthorizer, authorizer })
    if (mixed.length > 0) throw new Error(mixed.join('\n'))

    const auth = lambadaContext.authorization
        ? lambadaContext.authorization.resolve(name, authorizer)
        : legacyAuthorizers(lambadaContext, enableAuth ?? true, lambdaAuthorizer)

    var environment = lambadaContext.environment
    const grants = resolveGrants(lambadaContext, { name, resources })

    if (!policyStatements) {
        policyStatements = []
    }


    const envVars = resolveEnvironment(lambadaContext, { name, resources, environmentVariables })

    const callback = createLambda<E, R>({
        name,
        environment,
        definition: callbackDefinition,
        policyStatements,
        environmentVariables: envVars,
        resources: grants,
        options: mergeOptions(options, lambadaContext.api?.lambdaOptions),
        description: `${lambadaContext.projectName} ${method} ${path}`,
        tags: lambadaContext.globalTags,
        logs: lambadaContext.logs,
    })

    return {
        path: `${lambadaContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: auth,
        eventHandler: callback,
        apiKeyRequired: typeof apiKeyRequired === 'boolean' ? apiKeyRequired : lambadaContext?.api?.auth?.useApiKey === true
    }
}



const legacyAuthorizers = (
    lambadaContext: LambadaResources,
    enableAuth: boolean,
    lambdaAuthorizer: LambdaAuthorizer | undefined
): (CognitoAuthorizer | LambdaAuthorizer)[] => {
    if (lambdaAuthorizer) return [lambdaAuthorizer]
    if (typeof enableAuth === 'boolean' ? enableAuth : lambadaContext?.api?.auth?.useAuthorizers === true)
        return [...(lambadaContext.authorizers ?? [])]
    return []
}

export function mergeOptions(lambdaOptions: LambdaOptions | undefined, globalOptions: LambdaOptions | undefined): LambdaOptions {
    const keys = new Set([...Object.keys(globalOptions ?? {}), ...Object.keys(lambdaOptions ?? {})]) as Set<keyof LambdaOptions>
    return Object.fromEntries([...keys].map(key => [key, lambdaOptions?.[key] ?? globalOptions?.[key]]))
}

