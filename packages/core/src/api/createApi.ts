import * as awsx from "@pulumi/awsx/classic";
import * as pulumi from "@pulumi/pulumi";

import { Route, StaticRoute } from "@pulumi/awsx/classic/apigateway/api";

import { createCorsEndpoints } from "./createCorsEndpoints";
import { LambadaResources } from "../context";
import { createStaticEndpoint, EmbroideryApiEndpointCreator, LambadaCreatorTypes, LambadaEndpointCreator, LambadaProxyCreator, ProxyIntegrationArgs } from ".";
import { createEndpointSimpleCompat, LambadaEndpointArgs } from "./createEndpoint";
import { createProxyIntegrationCompat } from "./createProxyIntegration";
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
            headers: string[]
        },
        openApiSpec?: OpenAPIObjectConfigV31
    }
    www?: {
        local: string,
        path: string
    },
    context: LambadaResources
    stage?: {
        name?: string
        variables?: Record<string, pulumi.Input<string>>
    }
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
        stage,
        auth,
        options,
    }: CreateApiArgs
): awsx.apigateway.API | undefined {

    const stageName = stage?.name ?? 'app'

    const lambadaEndpoints: LambadaCreatorTypes[] = api?.apiEndpoints ? api.apiEndpoints
        .map(create => create(context))
        .filter(x => !!x)
        .map(x => x as NonNullable<LambadaCreatorTypes>) : []

    if (lambadaEndpoints.length === 0) {
        return undefined
    }
    const routes = lambadaEndpoints
        .map(x => {
            if (IsProxy(x)) return createProxyIntegrationCompat(x, context)
            if (IsEndpointsArgs(x)) return createEndpointSimpleCompat(x, context)
            return x
        })


    if (api?.openApiSpec) {
        const route = createOpenApiDocumentEndpoint({
            projectName,
            openApiSpec: api?.openApiSpec,
            endpoints: lambadaEndpoints.filter(IsEndpointsArgs),
            auth: auth?.apiKey
        })
        const args = route(context)
        routes.push(createEndpointSimpleCompat(args, context))
    }


    const corsEndpoints = api?.cors && lambadaEndpoints.length > 0 ?
        createCorsEndpoints(routes, context, api.cors.origins, api.cors.headers) : []

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
        //     warning: urn:pulumi:dev::backend-config-service::aws:apigateway:x:API$aws:apigateway/deployment:Deployment::configs-service-admin-dev verification warning: The attribute "stage_name" will be removed in a future major version. Use an explicit "aws_api_gateway_stage" instead.
        stageName: stageName,
        stageArgs: stage?.variables ? {
            variables: stage?.variables
        } : undefined,
        restApiArgs: {
            endpointConfiguration: api?.type || api?.vpcEndpointIds ? {
                types: api.type ?? 'EDGE',
                vpcEndpointIds: api.vpcEndpointIds
            } : undefined,
            policy: api?.policy
        },
        gatewayResponses: {
            'ACCESS_DENIED': {
                statusCode: 403,
                responseParameters: {
                    'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
                    'gatewayresponse.header.Access-Control-Allow-Headers': "'*'", //Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
                    'gatewayresponse.header.Access-Control-Allow-Methods': "'*'",
                },
                responseTemplates: {
                    "application/json": `{
                        "message": "$context.authorizer.message",
                        "error": {
                            "code": "$context.authorizer.context.errorCode",
                            "data": $context.authorizer.context.errorData
                        },
                        "errors":[
                            {
                                "code": "$context.authorizer.context.errorCode",
                                "data": $context.authorizer.context.errorData
                            }
                        ]
                    }`
                }
            }
        },

    }, {
        dependsOn: options?.dependsOn,
    });

    return apigateway;
}