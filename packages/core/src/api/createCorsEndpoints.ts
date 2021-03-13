import * as aws from '@pulumi/aws'
import { createLambda, lambdaAsumeRole } from '../lambdas';
import { Request, Response, EventHandlerRoute } from '@pulumi/awsx/apigateway/api'
import { LambadaResources } from '../context';
import { EmbroideryEventHandlerRoute } from '.';


export const createCorsEndpoints = (endpoints: EmbroideryEventHandlerRoute[], embroideryContext: LambadaResources): EmbroideryEventHandlerRoute[] => {

    function uniq(a: string[]) {
        return Array.from(new Set(a));
    }

    function replaceAll(input: string, search: string, replace: string) {
        return input.split(search).join(replace);
    }

    const uniquePaths = uniq(endpoints.map(x => x.path))


    const sharedCorsRole = new aws.iam.Role(`cors-shared-role-${embroideryContext.environment}`, {
        assumeRolePolicy: lambdaAsumeRole,
    })

    const corsEndpoints: EventHandlerRoute[] = uniquePaths.map(path => {
        const name = replaceAll(replaceAll(replaceAll(path.startsWith('/') ? path.substr(1) : path, "{", ""), "}", ""), "/", "-")
        const callback = async (req: Request): Promise<Response> => {
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*"
                },
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

    return [
        ...endpoints,
        ...corsEndpoints
    ]
}