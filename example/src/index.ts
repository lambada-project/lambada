import { run, createProxyIntegration, createEndpoint } from '@lambada/core'
import { createGetToDos } from './api/todos/get'
import { createPostToDo } from './api/todos/post'
import { tables } from './lib/dynamodb-repos/tables'
import { topics } from './messages'
import { createHandlerTodoItem_created } from './messages/todoItem_created'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'

const environment = pulumi.getStack()
const projectName = 'lambada-example'


const apigateway = new awsx.apigateway.API(`${projectName}-${environment}`, {
    routes: [
        {
            path: "/",
            method: "GET",
            eventHandler: async (event) => {
                // This code runs in an AWS Lambda anytime `/` is hit.
                return {
                    statusCode: 200,
                    body: "Hello, API Gateway!",
                };
            },
        }
    ],
    stageName: 'app',
}, {});


export const url = apigateway.url

// const result = run(project, environment,
//     {
//         endpointDefinitions: [
//             //createGetToDos,
//             //createPostToDo,
//             // (context) => createEndpoint('test', context, '/test', 'GET', async (event) => ({
//             //     statusCode: 200,
//             //     body: JSON.stringify({ ok: true }),
//             //     headers: {}
//             // }), [], {}, false, [], false, undefined),
//             (context) => createProxyIntegration(context, '/google', "https://www.google.com")
//         ],
//         createOptionsForCors: false,
//         // messageHandlerDefinitions: [
//         //     createHandlerTodoItem_created
//         // ],
//         //staticSiteLocalPath: 'src/www',
//         tables: tables,
//         //messages: topics,

//         cdn: {
//             useCDN: false
//         },
//         environmentVariables: {
//             LAMBADA_SHOW_ALL_ERRORS: 'true'
//         }
//     })






// export const apiUrl = result.api.url
// export const cdnUrl = result.cdn?.domainName