import * as aws from '@pulumi/aws'
import { createLambda, lambdaAssumeRole } from '../lambdas';
import { Request, Response, EventHandlerRoute, IntegrationRoute } from '@pulumi/awsx/apigateway/api'
import { LambadaResources } from '../context';
import { EmbroideryEventHandlerRoute } from '.';
import { getNameFromPath } from './utils';
import { getCorsHeaders } from '@lambada/utils';

export const createCorsEndpoints = (endpoints: EmbroideryEventHandlerRoute[], embroideryContext: LambadaResources, origins?: string[]): EmbroideryEventHandlerRoute[] => {

    function uniq(a: string[]) {
        return Array.from(new Set(a));
    }

    const isIntegrationRoute = (route: EmbroideryEventHandlerRoute): route is IntegrationRoute => {
        return typeof (route as IntegrationRoute).target !== 'undefined'
    }

    const isEventHandlerRoute = (route: EmbroideryEventHandlerRoute): route is EventHandlerRoute => {
        return typeof (route as EventHandlerRoute).eventHandler !== 'undefined'
    }

    // Integration routes cannot have cors
    const uniquePaths = uniq(endpoints.filter(x => {
        if (isEventHandlerRoute(x)) {
            return true
        }
        return false
    }).map(x => x.path))

    if (uniquePaths.length == 0) return []

    const sharedCorsRole = new aws.iam.Role(`${embroideryContext.projectName}-cors-shared-role-${embroideryContext.environment}`, {
        assumeRolePolicy: lambdaAssumeRole,
    })

    const corsEndpoints: EventHandlerRoute[] = uniquePaths.map(path => {
        const name = getNameFromPath(path)
        const callback = async (req: Request): Promise<Response> => {
            return {
                statusCode: 200,
                headers: getCorsHeaders(req.requestContext.domainName, origins),
                body: JSON.stringify({
                    data: {}
                }),
            }
        }

        return {
            eventHandler: createLambda(`cors-${name}`, embroideryContext.environment, callback, [], {}, [], sharedCorsRole),
            method: 'OPTIONS',
            path: path,
            authorizers: []
        }
    })

    return corsEndpoints
}