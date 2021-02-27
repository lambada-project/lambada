import * as pulumi from "@pulumi/pulumi";
import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { Route, IntegrationRoute } from "@pulumi/awsx/apigateway/api";
import { EmbroideryContext } from "..";
import { IntegrationType } from "aws-sdk/clients/apigateway";

export const createProxyIntegration = (
    embroideryContext: EmbroideryContext,
    path: string,
    targetUri: pulumi.Input<string>,
    enableAuth = true,
): Route => {
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