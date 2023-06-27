import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx/classic";
import * as pulumi from "@pulumi/pulumi";

import { Route, StaticRoute } from "@pulumi/awsx/classic/apigateway/api";

//import { MessagingResult } from "../messaging";

//import { NotificationResult } from "../notifications";
import { createCorsEndpoints } from "./createCorsEndpoints";
import { LambadaResources } from "../context";
import { createStaticEndpoint, EmbroideryApiEndpointCreator, LambadaCreatorTypes, LambadaEndpointCreator, LambadaProxyCreator, ProxyIntegrationArgs } from ".";
import { createEndpointSimple, createEndpointSimpleCompat, LambadaEndpointArgs } from "./createEndpoint";
import { createProxyIntegration, createProxyIntegrationCompat } from "./createProxyIntegration";
import { createOpenApiDocumentEndpoint } from "./openApiDocument";
import { OpenAPIObjectConfigV31 } from "@asteasolutions/zod-to-openapi/dist/v3.1/openapi-generator";

export type LambadaCreator = EmbroideryApiEndpointCreator | LambadaEndpointCreator | LambadaProxyCreator
type LambadaCreatorReturn = Route | LambadaEndpointArgs | ProxyIntegrationArgs


type CreateApiArgs = {
    projectName: string
    environment: string
    api?: {
        path: string,
        type?: `EDGE` | `REGIONAL` | `PRIVATE`
        vpcEndpointIds?: pulumi.Input<pulumi.Input<string>[]> | undefined,
        apiEndpoints: (LambadaCreator)[],
        policy?: pulumi.Input<string> | undefined,
        cors?: {
            origins: string[]
        },
        openApiSpec?: OpenAPIObjectConfigV31
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
    auth?: {
        apiKey?: {
            name?: string
            openapi?: {
                description: string
            }
        }
    }
    options?: {
        dependsOn: pulumi.Input<pulumi.Resource> | pulumi.Input<pulumi.Input<pulumi.Resource>[]> | undefined
    }
}

export const IsEndpointsArgs = (route: LambadaCreatorReturn): route is LambadaEndpointArgs => {
    return typeof (route as LambadaEndpointArgs).callbackDefinition !== 'undefined'
}
export const IsProxy = (route: LambadaCreatorReturn): route is ProxyIntegrationArgs => {
    return typeof (route as ProxyIntegrationArgs).targetUri !== 'undefined'
}

export default function createApi(
    {
        projectName,
        environment,
        api,
        www,
        context,
        // authorizerProviderARNs,
        // messaging,
        // notifications,
        // databases,
        // kmsKeys,
        // environmentVariables,
        // secrets
        auth,
        options,
    }: CreateApiArgs
): awsx.apigateway.API {

    const stageName = 'app'

    const lambadaEndpoints: LambadaCreatorTypes[] = api?.apiEndpoints ? api.apiEndpoints
        .map(create => create(context))
        .filter(x => !!x)
        .map(x => x as NonNullable<LambadaCreatorTypes>) : []

    const routes = lambadaEndpoints
        .map(x => {
            if (IsProxy(x)) return createProxyIntegrationCompat(x, context)
            if (IsEndpointsArgs(x)) return createEndpointSimpleCompat(x, context)
            return x
        })


    if (api?.openApiSpec) {
        const route = createOpenApiDocumentEndpoint({
            openApiSpec: api?.openApiSpec,
            endpoints: lambadaEndpoints.filter(IsEndpointsArgs),
            auth: auth?.apiKey
        })
        const args = route(context)
        routes.push(createEndpointSimpleCompat(args, context))
    }




    // TODO: Configure per endpoint?
    const corsEndpoints = api?.cors && lambadaEndpoints.length > 0 ?
        createCorsEndpoints(routes, context, api.cors.origins) : []

    const staticRoutes: StaticRoute[] = []
    if (www) {
        staticRoutes.push(createStaticEndpoint(www.path, www.local))
    }

    const allRoutes: Route[] = [
        ...routes,
        ...corsEndpoints,
        ...staticRoutes
    ]

    const apigateway = new awsx.apigateway.API(`${projectName}-${environment}`, {
        routes: allRoutes,
        stageName: stageName,
        restApiArgs: {
            endpointConfiguration: api?.type || api?.vpcEndpointIds ? {
                types: api.type ?? 'EDGE',
                vpcEndpointIds: api.vpcEndpointIds
            } : undefined,
            policy: api?.policy
        },

    }, {
        dependsOn: options?.dependsOn,
    });

    return apigateway;
}