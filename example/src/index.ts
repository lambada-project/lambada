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

const result = run(projectName, environment,
    {
        endpointDefinitions: [
            createGetToDos,
            createPostToDo,
            (context) => createEndpoint('test', context, '/test', 'GET', async (event) => ({
                statusCode: 200,
                body: JSON.stringify({ ok: true }),
                headers: {}
            }), [], {}, false, [], false, undefined),
            (context) => createProxyIntegration(context, '/google', "https://www.google.com")
        ],
        createOptionsForCors: false,
        messageHandlerDefinitions: [
            createHandlerTodoItem_created
        ],
        staticSiteLocalPath: 'src/www',
        tables: tables,
        messages: topics,

        cdn: {
            useCDN: true,
            isSpa: true
        },
        environmentVariables: {
            LAMBADA_SHOW_ALL_ERRORS: 'true'
        }
    })

export const apiUrl = result.api.url
export const cdnUrl = result.cdn?.domainName