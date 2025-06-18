import { LambadaResources, IsEndpointsArgs } from '..'
import { LambadaEndpointArgs } from './createEndpoint'

import {
    OpenAPIRegistry,
    RouteConfig
} from '@asteasolutions/zod-to-openapi';

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { OpenAPIObjectConfigV31, OpenApiGeneratorV31, } from '@asteasolutions/zod-to-openapi/dist/v3.1/openapi-generator'

extendZodWithOpenApi(z);


export const createOpenApiDocumentEndpoint = (args: {
    projectName: string,
    openApiSpec: OpenAPIObjectConfigV31,
    endpoints: LambadaEndpointArgs[],
    auth?: {
        name?: string
        openapi?: {
            description?: string
        }
    }
}) => {
    const registry = new OpenAPIRegistry();
    const name = args.auth?.name ?? 'Authorization'

    const bearerAuth = registry.registerComponent('securitySchemes', name, {
        type: 'apiKey',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: name,
        description: args.auth?.openapi?.description,
    });

    args.endpoints
        .filter(x => IsEndpointsArgs(x))
        .forEach(x => {
            if (!x.openapi) return
            const config = x.openapi(registry)

            const toLowerCase = <T extends string>(s: T): Lowercase<T> => {
                return s.toLowerCase() as any;
            }

            const endpoint = {
                ...config,
                method: toLowerCase(x.method),
                path: x.path,
                responses: config.responses //not sure why ts is not getting that config.responses is a RouteConfig and {responses: config.responses
            } satisfies RouteConfig

            if (x.webhook) {
                registry.registerWebhook(endpoint)
            }
            else {
                registry.registerPath(endpoint)
            }

        })



    function getOpenApiDocumentation() {
        const generator = new OpenApiGeneratorV31(registry.definitions);
        return generator.generateDocument(args.openApiSpec);
    }


    const docs = getOpenApiDocumentation();
    const fileContent = JSON.stringify(docs)//yaml.stringify(docs);
    //console.log(fileContent)



    return (context: LambadaResources): LambadaEndpointArgs => ({
        name: `${args.projectName}_get_openapi`,
        path: '/openapi',
        method: 'GET',
        auth: {
            useCognitoAuthorizer: false
        },
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