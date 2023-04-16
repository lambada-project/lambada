import * as AWS from 'aws-sdk'
import { LambadaResources, LambadaEndpointCreator, LambadaCreator, IsEndpointsArgs } from '..'
import { LambadaEndpointArgs, createEndpoint } from './createEndpoint'
import { Request, Response, Route } from '@pulumi/awsx/classic/apigateway/api'
import { Callback } from '@pulumi/aws/lambda'


import {
    OpenAPIGenerator,
    OpenAPIRegistry,
    RouteConfig
} from '@asteasolutions/zod-to-openapi';

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { OpenAPIObjectConfig } from '@asteasolutions/zod-to-openapi/dist/openapi-generator'
extendZodWithOpenApi(z);

//import * as yaml from 'yaml';




export const createOpenApiDocumentEndpoint = (openApiSpec: OpenAPIObjectConfig, endpoints: LambadaEndpointArgs[]) => {
    const registry = new OpenAPIRegistry();

    const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'apiKey',
        scheme: 'bearer',
        bearerFormat: 'JWT',
    });

    endpoints
        .filter(x => IsEndpointsArgs(x))
        .forEach(x => {
            if (!x.openapi) return
            const config = x.openapi(registry)

            const endpoint = {
                ...config,
                method: x.method.toLowerCase() as any,// :(,
                path: x.path,
            } satisfies RouteConfig

            if (x.webhook) {
                registry.registerWebhook(endpoint)
            }
            else {
                registry.registerPath(endpoint)
            }

        })



    function getOpenApiDocumentation() {
        const generator = new OpenAPIGenerator(registry.definitions, '3.0.0');
        return generator.generateDocument(openApiSpec);
    }


    const docs = getOpenApiDocumentation();
    const fileContent = JSON.stringify(docs)//yaml.stringify(docs);
    //console.log(fileContent)



    return (context: LambadaResources): LambadaEndpointArgs => ({
        name: 'get_openapi_spec',
        path: '/openapi',
        method: 'GET',
        callbackDefinition: async (): Promise<object> => {
            return {
                statusCode: 200,
                body: fileContent
            }
        }
        ,
    })
}



/*
const UserIdSchema = registry.registerParameter(
    'UserId',
    z.string().openapi({
        param: {
            name: 'id',
            in: 'path',
        },
        example: '1212121',
    })
);
const UserSchema = registry.register(
    'User',
    z.object({
        id: z.string().openapi({
            example: '1212121',
        }),
        name: z.string().openapi({
            example: 'John Doe',
        }),
        age: z.number().openapi({
            example: 42,
        }),
    })
);


registry.registerPath({
    method: 'get',
    path: '/users/{id}',
    description: 'Get user data by its id',
    summary: 'Get a single user',
    security: [{ [bearerAuth.name]: [] }],
    request: {
        params: z.object({ id: UserIdSchema }),
    },
    responses: {
        200: {
            description: 'Object with user data.',
            content: {
                'application/json': {
                    schema: UserSchema,
                },
            },
        },
        204: {
            description: 'No content - successful operation',
        },
    },
});
*/


// export const getOpenApiDocument: Callback<Request, Response> = async (request: Request): Promise<Response> => {
//     const gateway = new AWS.APIGateway({

//     })

//     const exported = await gateway.getExport({
//         restApiId: request.requestContext.apiId,
//         exportType: 'oas30',
//         stageName: request.requestContext.stage,
//         accepts: 'application/json'
//     }).promise()

//     let body = ''

//     if (typeof exported.body === 'string')
//         body = exported.body
//     else if (exported.body)
//         body = exported.body.toString()

//     return {
//         statusCode: 200,
//         body: body,
//         headers: {
//             'Content-Type': "application/json"
//         }
//     }
// }

// export const createOpenApiDocumentEndpoint = (context: LambadaResources): any => {
//     return createEndpoint<Request, Response>(context.projectName + '-openapi', context, '/openapi', 'GET', getOpenApiDocument, [], undefined, false, [
//         {
//             arn: 'arn:aws:apigateway',
//             access: ['apigateway:GET']
//         }
//     ])
// }