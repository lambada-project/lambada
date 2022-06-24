import * as aws from '@pulumi/aws'
import { createLambda, lambdaAsumeRole } from '../lambdas';
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
        assumeRolePolicy: lambdaAsumeRole,
    })

    const corsEndpoints: EventHandlerRoute[] = uniquePaths.map(path => {
        //7 random characters at the end. minus "cors-", minus environment name, minus 2 separators
        const name = getNameFromPath(path, 64 - 7 - 5 - embroideryContext.environment.length - 2) 
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