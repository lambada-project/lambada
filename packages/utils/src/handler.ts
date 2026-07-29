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
    // Destructured to mirror `createCallback`'s parameter list one-for-one. `extraHeaders` is `let`
    // because the original reassigned its parameter; see the commit that follows this one.
    let { extraHeaders } = config
    const { cors, cacheControl, callbackWaitsForEmptyEventLoop } = config

    return async (request: Request, ctx: TContext): Promise<HandlerResponse> => {
        if (callbackWaitsForEmptyEventLoop !== undefined) {
            ctx.callbackWaitsForEmptyEventLoop = callbackWaitsForEmptyEventLoop
        }

        extraHeaders = {
            ...getCorsHeaders(getRequestOrigin(request.headers), cors?.origins, cors?.headers),
            ...(extraHeaders ?? {})
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
