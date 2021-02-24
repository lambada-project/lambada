import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

import { CognitoAuthorizer } from "@pulumi/awsx/apigateway/cognitoAuthorizer";

import { EventHandlerRoute, IntegrationRoute, RawDataRoute, Route, StaticRoute } from "@pulumi/awsx/apigateway/api";

//import { MessagingResult } from "../messaging";

//import { NotificationResult } from "../notifications";
import { DatabaseResult } from "../database";
import { SecretsResult, SecurityResult } from "../security";
import { createEndpoint } from "./createEndpoint";
import { createLambda, lambdaAsumeRole } from "../lambdas";
import { Request, Response } from '@pulumi/awsx/apigateway/api'
import { createCorsEndpoints } from "./createCorsEndpoints";
import { EmbroideryContext } from "../context";
import { MessagingResult } from "../messaging";
import { NotificationResult } from "../notifications";
import { createStaticEndpoint, EmbroideryApiEndpointCreator } from ".";
import { EmbroideryEnvironmentVariables } from "..";

type CreateApiArgs = {
    projectName: string
    environment: string
    api?: {
        path: string,
        type: `EDGE` | `REGIONAL` | `PRIVATE`
        apiEndpoints: EmbroideryApiEndpointCreator[],
        createOptionsForCors?: boolean      
    }
    www?: {
        local: string,
        path: string
    },
    context: EmbroideryContext
    // authorizerProviderARNs?:  (pulumi.Input<string> | aws.cognito.UserPool)[]
    // messaging?: MessagingResult
    // notifications?: NotificationResult
    // databases?: DatabaseResult
    // kmsKeys?: SecurityResult
    // environmentVariables?: EmbroideryEnvironmentVariables
    // secrets?: SecretsResult
}

export default function createApi(
    {
        projectName,
        environment,
        api,
        www,
        context
        // authorizerProviderARNs,
        // messaging,
        // notifications,
        // databases,
        // kmsKeys,
        // environmentVariables,
        // secrets
    }: CreateApiArgs
): awsx.apigateway.API {

    const stageName = 'app'

    const routes = api?.apiEndpoints  ? api.apiEndpoints.map(createEndpoint => createEndpoint(context)) : []

    // TODO: Configure per endpoint?
    const endpointsWithCors = api?.createOptionsForCors ? createCorsEndpoints(routes, context) : routes

    const staticRoutes: StaticRoute[] = []
    if (www) {
        staticRoutes.push(createStaticEndpoint(www.path, www.local))
    }

    const allRoutes: Route[] = [
        ...endpointsWithCors,
        ...staticRoutes
    ]

    const apigateway = new awsx.apigateway.API(`${projectName}-${environment}`, {
        routes: allRoutes,
        stageName: stageName,
        restApiArgs: {
            endpointConfiguration: api ? {
                types: api.type,
            } : undefined
        },
    }, {

    });

    // awsx.apigateway.createAssociatedAPIKeys('master', {

    // })

    return apigateway;
}