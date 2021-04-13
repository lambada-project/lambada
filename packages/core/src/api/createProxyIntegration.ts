import * as pulumi from "@pulumi/pulumi";
import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { Route, IntegrationRoute } from "@pulumi/awsx/apigateway/api";
import { LambadaResources } from "..";
import { IntegrationType } from "aws-sdk/clients/apigateway";

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