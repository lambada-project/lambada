
import { createHandler, WrapperConfig } from '@lambada/utils';

import { Response } from '@pulumi/awsx/classic/apigateway/api'
import { EmbroideryCallback } from "./createEndpoint"
import * as awslambda from "aws-lambda"
import { LambadaResources } from '..';
import { LambdaOptions } from '../lambdas';
export declare type Request = awslambda.APIGatewayProxyEvent;
export declare type LambdaContext = awslambda.Context

type Wrapper = (request: Request, ctx: LambdaContext) => Promise<Response>


/**
 * Maps deploy-time `LambadaResources` onto the plain `WrapperConfig` that `@lambada/utils` consumes.
 *
 * The wrapper body itself lives in `@lambada/utils` because that package is Pulumi-free: a Lambda
 * deployed as a pre-built bundle (rather than through Pulumi's closure serializer) can import it at
 * runtime, while this package cannot. Keeping the adapter here and the behaviour there means both
 * deployment styles share one implementation.
 */
export function toWrapperConfig(
    {
        context,
        extraHeaders,
        options,
        cacheControl
    }: {
        context: LambadaResources,
        extraHeaders?: {},
        options?: LambdaOptions,
        cacheControl?: string
    }
): WrapperConfig {
    return {
        cors: {
            origins: context.api?.cors?.origins,
            headers: context.api?.cors?.headers
        },
        extraHeaders: extraHeaders,
        cacheControl: cacheControl,
        callbackWaitsForEmptyEventLoop:
            options?.callbackWaitsForEmptyEventLoop ??
            context.api?.lambdaOptions?.callbackWaitsForEmptyEventLoop
    }
}

export function createCallback(
    {
        callbackDefinition,
        context,
        extraHeaders,
        options,
        cacheControl
    }: {
        callbackDefinition: EmbroideryCallback,
        context: LambadaResources,
        extraHeaders?: {},
        options?: LambdaOptions,
        cacheControl?: string
    }
): Wrapper {
    return createHandler<LambdaContext>(
        callbackDefinition,
        toWrapperConfig({ context, extraHeaders, options, cacheControl })
    )
}
