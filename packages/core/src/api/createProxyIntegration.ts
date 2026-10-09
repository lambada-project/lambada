import * as pulumi from "@pulumi/pulumi";
import { Route, IntegrationRoute } from "@pulumi/awsx/classic/apigateway/api";
import { LambadaResources } from "..";
import { AuthorizerSelection, styleProblems } from "../auth/authorizers";

export const createProxyIntegration = (
    embroideryContext: LambadaResources,
    path: string,
    targetUri: pulumi.Input<string>,
    /** @deprecated Select an authorizer by name with `auth.authorizer`. */
    enableAuth?: boolean,
    auth?: { authorizer?: AuthorizerSelection },
): Route => {
    return createProxyIntegrationCompat({ path, targetUri, enableAuth: embroideryContext.authorization ? enableAuth : enableAuth ?? true, auth }, embroideryContext)
}

export type ProxyIntegrationArgs = {
    path: string,
    targetUri: pulumi.Input<string>,
    /** @deprecated Select an authorizer by name with `auth.authorizer`. */
    enableAuth?: boolean,
    auth?: {
        /** A name from run()'s `auth.authorizers`, or `false` for public. Left out, the stack default. */
        authorizer?: AuthorizerSelection
    },
}

export const createProxyIntegrationCompat = ({ path, targetUri, enableAuth, auth }: ProxyIntegrationArgs, embroideryContext: LambadaResources): Route => {
    const mixed = styleProblems(embroideryContext.authorization, path, { enableAuth, authorizer: auth?.authorizer })
    if (mixed.length > 0) throw new Error(mixed.join('\n'))

    const route: IntegrationRoute = {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        authorizers: embroideryContext.authorization ? embroideryContext.authorization.resolve(path, auth?.authorizer)
            : enableAuth ? embroideryContext.authorizers : [],
        target: {
            type: 'http_proxy',
            httpMethod: 'ANY',
            uri: targetUri,
        }
    }
    return route
}
