import * as awslambda from 'aws-lambda'
import { getCorsHeaders, getRequestOrigin } from './cors'
import { AuthExecutionContext, getContext, Request } from './request'

export declare type HandlerResponse = awslambda.APIGatewayProxyResult

/**
 * The only thing the wrapper needs from the Lambda context. Keeping this structural — rather than
 * importing a concrete `Context` — is what lets `@lambada/core` pass its own `aws.lambda.Context`
 * without this package depending on Pulumi.
 */
export type WrappableContext = {
    callbackWaitsForEmptyEventLoop: boolean
}

export type HandlerRequest<TContext> = {
    user?: AuthExecutionContext
    request: Request
    context: TContext
}

export type HandlerCallback<TContext> = (event: HandlerRequest<TContext>) => Promise<object>

/**
 * Everything the wrapper needs from the deployment, as plain values.
 *
 * `@lambada/core` derives this from `LambadaResources` at deploy time and captures it in the Pulumi
 * closure. A bundled Lambda reads the same fields from environment variables instead. Both call the
 * function below, so the request/response contract cannot drift between the two deployment styles.
 */
export type WrapperConfig = {
    cors?: {
        origins?: string[]
        headers?: string[]
    }
    extraHeaders?: { [name: string]: string }
    cacheControl?: string
    /** Left untouched when undefined, preserving whatever the runtime defaulted it to. */
    callbackWaitsForEmptyEventLoop?: boolean
}

/**
 * Environment variables carrying the wrapper config into a bundled Lambda. Declared here, next to the
 * only code that reads them, so `@lambada/core` writing them and `wrapperConfigFromEnv` reading them
 * cannot drift apart.
 */
export const WRAPPER_ENV = {
    corsOrigins: 'LAMBADA_CORS_ORIGINS',
    corsHeaders: 'LAMBADA_CORS_HEADERS',
    extraHeaders: 'LAMBADA_EXTRA_HEADERS',
    cacheControl: 'LAMBADA_CACHE_CONTROL',
    callbackWaitsForEmptyEventLoop: 'LAMBADA_CALLBACK_WAITS_FOR_EMPTY_EVENT_LOOP'
} as const

/**
 * Rebuilds the config inside a bundled Lambda, where there is no Pulumi closure to capture it from.
 *
 * An absent variable stays `undefined` rather than becoming a default, so the wrapper falls back to the
 * same behaviour it has when the deployment configured nothing.
 */
export const wrapperConfigFromEnv = (env: { [key: string]: string | undefined } = process.env): WrapperConfig => {
    const list = (value: string | undefined): string[] | undefined =>
        value === undefined ? undefined : value.split(',').map(x => x.trim()).filter(x => x.length > 0)

    const waits = env[WRAPPER_ENV.callbackWaitsForEmptyEventLoop]
    const extraHeaders = env[WRAPPER_ENV.extraHeaders]

    return {
        cors: {
            origins: list(env[WRAPPER_ENV.corsOrigins]),
            headers: list(env[WRAPPER_ENV.corsHeaders])
        },
        extraHeaders: extraHeaders ? JSON.parse(extraHeaders) : undefined,
        cacheControl: env[WRAPPER_ENV.cacheControl],
        callbackWaitsForEmptyEventLoop: waits === undefined ? undefined : waits === 'true'
    }
}

/**
 * The config as environment variables, for a bundled Lambda that has no closure to capture it from.
 * `@lambada/core` calls this at deploy time; `wrapperConfigFromEnv` above is the reader.
 *
 * Only set keys are emitted — an absent variable means "not configured", which the wrapper treats the
 * same way as an unset field.
 */
export const toWrapperEnvVars = (config: WrapperConfig): { [key: string]: string } => {
    const vars: { [key: string]: string } = {}

    if (config.cors?.origins) vars[WRAPPER_ENV.corsOrigins] = config.cors.origins.join(',')
    if (config.cors?.headers) vars[WRAPPER_ENV.corsHeaders] = config.cors.headers.join(',')
    if (config.extraHeaders && Object.keys(config.extraHeaders).length > 0)
        vars[WRAPPER_ENV.extraHeaders] = JSON.stringify(config.extraHeaders)
    if (config.cacheControl) vars[WRAPPER_ENV.cacheControl] = config.cacheControl
    if (config.callbackWaitsForEmptyEventLoop !== undefined)
        vars[WRAPPER_ENV.callbackWaitsForEmptyEventLoop] = String(config.callbackWaitsForEmptyEventLoop)

    return vars
}

const isResponse = (result: any): boolean => {
    return result && (
        result.body && result.statusCode
    )
}

/**
 * Wraps a callback into an API Gateway proxy handler: resolves the auth context, merges CORS and
 * extra headers onto the response, and turns a thrown error into a 500 envelope.
 */
export function createHandler<TContext extends WrappableContext>(
    callbackDefinition: HandlerCallback<TContext>,
    config: WrapperConfig = {}
): (request: Request, ctx: TContext) => Promise<HandlerResponse> {
    const { cors, cacheControl, callbackWaitsForEmptyEventLoop } = config

    return async (request: Request, ctx: TContext): Promise<HandlerResponse> => {
        if (callbackWaitsForEmptyEventLoop !== undefined) {
            ctx.callbackWaitsForEmptyEventLoop = callbackWaitsForEmptyEventLoop
        }

        // Must stay local to the invocation. Lambda reuses a warm container, so anything merged into
        // a variable captured by this closure outlives the request that produced it -- and the CORS
        // headers below are request-derived.
        let extraHeaders: { [name: string]: string } = {
            ...getCorsHeaders(getRequestOrigin(request.headers), cors?.origins, cors?.headers),
            ...(config.extraHeaders ?? {})
        }

        if (cacheControl)
            extraHeaders = { ...extraHeaders, ...({ 'cache-control': cacheControl }) }

        if (request.requestContext.accountId === "000000000000" && process.env.IS_LOCALSTACK === 'true') {
            console.log('Mocking user on account 000000000000');
            request.requestContext.authorizer = {
                claims: {
                    iss: '123456789',
                    sub: request.headers['x-mock-user-id'],
                    username: request.headers['x-mock-username'],
                    'cognito:username': request.headers['x-mock-username'],
                    email: request.headers['x-mock-email'],
                }
            }
        }

        const authContext = await getContext(request)
        try {
            const result = await callbackDefinition({
                user: authContext,
                request,
                context: ctx
            })

            if (isResponse(result)) {

                const resultTyped = result as any

                if (typeof resultTyped.body !== 'string') {
                    resultTyped.body = JSON.stringify(resultTyped.body)
                }

                return {
                    ...resultTyped,
                    headers: {
                        ...(extraHeaders || {}),
                        ...(resultTyped.headers || {}),
                    }
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify(result ?? {}),
                headers: (extraHeaders || {})
            }

        } catch (ex: any) {
            console.error(ex)
            const showErrorDetails = ex && (ex.showError || process.env['LAMBADA_SHOW_ALL_ERRORS'] == 'true')
            if (showErrorDetails) {
                return {
                    statusCode: ex.statusCode ?? 500,
                    body: JSON.stringify({

                        error: {
                            message: ex.message ?? ex.errorMessage,
                            code: ex.code ?? ex.errorCode,
                            data: ex.data
                        },

                        errors: [
                            {
                                message: ex.message ?? ex.errorMessage,
                                code: ex.code ?? ex.errorCode,
                                data: ex.data
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
            }
        }
    }
}
