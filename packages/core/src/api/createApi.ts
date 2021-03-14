import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

import { Route, StaticRoute } from "@pulumi/awsx/apigateway/api";

//import { MessagingResult } from "../messaging";

//import { NotificationResult } from "../notifications";
import { createCorsEndpoints } from "./createCorsEndpoints";
import { LambadaResources } from "../context";
import { createStaticEndpoint, EmbroideryApiEndpointCreator, LambadaEndpointCreator } from ".";
import { createEndpointSimple, createEndpointSimpleCompat, LambadaEndpointArgs } from "./createEndpoint";

type CreateApiArgs = {
    projectName: string
    environment: string
    api?: {
        path: string,
        type: `EDGE` | `REGIONAL` | `PRIVATE`
        apiEndpoints: (EmbroideryApiEndpointCreator | LambadaEndpointCreator)[],
        createOptionsForCors?: boolean
    }
    www?: {
        local: string,
        path: string
    },
    context: LambadaResources
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
    const isRoute = (route: Route | LambadaEndpointArgs): route is Route => {
        return typeof (route as LambadaEndpointArgs).callbackDefinition === 'undefined'
    }

    const lambadaEndpoints = api?.apiEndpoints ? api.apiEndpoints
        .map(createEndpoint => createEndpoint(context))
        .map(x => isRoute(x) ? x : createEndpointSimpleCompat(x, context))
        : []

    // TODO: Configure per endpoint?
    const corsEndpoints = api?.createOptionsForCors && lambadaEndpoints.length > 0 ?
        createCorsEndpoints(lambadaEndpoints, context) : []

    const staticRoutes: StaticRoute[] = []
    if (www) {
        staticRoutes.push(createStaticEndpoint(www.path, www.local))
    }

    const allRoutes: Route[] = [
        ...lambadaEndpoints,
        ...corsEndpoints,
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