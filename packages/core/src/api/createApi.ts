import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

import { Route, StaticRoute } from "@pulumi/awsx/apigateway/api";

//import { MessagingResult } from "../messaging";

//import { NotificationResult } from "../notifications";
import { createCorsEndpoints } from "./createCorsEndpoints";
import { LambadaResources } from "../context";
import { createStaticEndpoint, EmbroideryApiEndpointCreator, LambadaCreatorTypes, LambadaEndpointCreator, LambadaProxyCreator, ProxyIntegrationArgs } from ".";
import { createEndpointSimple, createEndpointSimpleCompat, LambadaEndpointArgs } from "./createEndpoint";
import { createProxyIntegration, createProxyIntegrationCompat } from "./createProxyIntegration";

export type LambadaCreator = EmbroideryApiEndpointCreator | LambadaEndpointCreator | LambadaProxyCreator
type LambadaCreatorReturn = Route | LambadaEndpointArgs | ProxyIntegrationArgs


type CreateApiArgs = {
    projectName: string
    environment: string
    api?: {
        path: string,
        type: `EDGE` | `REGIONAL` | `PRIVATE`
        apiEndpoints: (LambadaCreator)[],
        cors?: {
            origins: string[]
        }
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
    const IsCallback = (route: LambadaCreatorReturn): route is LambadaEndpointArgs => {
        return typeof (route as LambadaEndpointArgs).callbackDefinition !== 'undefined'
    }
    const IsProxy = (route: LambadaCreatorReturn): route is ProxyIntegrationArgs => {
        return typeof (route as ProxyIntegrationArgs).targetUri !== 'undefined'
    }

    const lambadaEndpoints = api?.apiEndpoints ? api.apiEndpoints
        .map(create => create(context))
        .filter(x => !!x)
        .map(x => x as NonNullable<LambadaCreatorTypes>)
        .map(x => IsCallback(x) ? createEndpointSimpleCompat(x, context) : x)
        .map(x => IsProxy(x) ? createProxyIntegrationCompat(x, context) : x)
        : []

    // TODO: Configure per endpoint?
    const corsEndpoints = api?.cors && lambadaEndpoints.length > 0 ?
        createCorsEndpoints(lambadaEndpoints, context, api.cors.origins) : []

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
        }
    }, {

    });

    return apigateway;
}