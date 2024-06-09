
import { getCorsHeaders } from '@lambada/utils';
import { getContext } from '@lambada/utils';

import { Response } from '@pulumi/awsx/classic/apigateway/api'
import { EmbroideryCallback } from "./createEndpoint"
import * as awslambda from "aws-lambda"
import { LambadaResources } from '..';
import { LambdaOptions } from '../lambdas';
export declare type Request = awslambda.APIGatewayProxyEvent;
export declare type LambdaContext = awslambda.Context

type Wrapper = (request: Request, ctx: LambdaContext) => Promise<Response>



export function createCallback(
    {
        callbackDefinition,
        context,
        extraHeaders,
        options
    }: {
        callbackDefinition: EmbroideryCallback,
        context: LambadaResources,
        extraHeaders?: {},
        options?: LambdaOptions
    }
): Wrapper {
    const isResponse = (result: any): boolean => {
        return result && (
            result.body && result.statusCode
        )
    }
    const callback = async (request: Request, ctx: LambdaContext): Promise<Response> => {
        ctx.callbackWaitsForEmptyEventLoop = options?.callbackWaitsForEmptyEventLoop ?? context.api?.lambdaOptions?.callbackWaitsForEmptyEventLoop ?? ctx.callbackWaitsForEmptyEventLoop;

        extraHeaders = { ...getCorsHeaders(request.requestContext.domainName, context.api?.cors?.origins), ...(extraHeaders ?? {}) }
        const authContext = await getContext(request)
        try {
            const result = await callbackDefinition({
                user: authContext,
                request
            })

            if (isResponse(result)) {

                const resultTyped = result as any

                if (typeof resultTyped.body !== 'string') {
                    resultTyped.body = JSON.stringify(resultTyped.body)
                }

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


    return callback
}