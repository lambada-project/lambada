import * as pulumi from "@pulumi/pulumi";
import { Route, IntegrationRoute } from "@pulumi/awsx/classic/apigateway/api";
import { LambadaResources } from "..";

export const createProxyIntegration = (
    embroideryContext: LambadaResources,
    path: string,
    targetUri: pulumi.Input<string>,
    enableAuth = true,
): Route => {
    return createProxyIntegrationCompat({ path, targetUri, enableAuth }, embroideryContext)
}

export type ProxyIntegrationArgs = {    
    path: string,
    targetUri: pulumi.Input<string>,
    enableAuth: boolean,
}

export const createProxyIntegrationCompat = ({ path, targetUri, enableAuth }: ProxyIntegrationArgs, embroideryContext: LambadaResources): Route => {
    const route: IntegrationRoute = {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        authorizers: enableAuth ? embroideryContext.authorizers : [],
        target: {
            type: 'http_proxy',
            httpMethod: 'ANY',
            uri: targetUri,
        }
    }
    return route
}