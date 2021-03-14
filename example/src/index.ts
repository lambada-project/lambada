import { run, createProxyIntegration } from '@lambada/core'
import { createGetToDos } from './api/todos/get'
import { createPostToDo } from './api/todos/post'
import { tables } from './lib/dynamodb-repos/tables'
import { topics } from './messages'
import { createHandlerTodoItem_created } from './messages/todoItem_created'
import * as pulumi from '@pulumi/pulumi'

const environment = pulumi.getStack()
const project = 'embroidery-example'

const result = run(project, environment,
    {
        endpointDefinitions: [
            //createGetToDos,
            //createPostToDo,
            (context) => createProxyIntegration(context, '/google', "https://www.google.com")
        ],
        createOptionsForCors: true,
        // messageHandlerDefinitions: [
        //     createHandlerTodoItem_created
        // ],
        staticSiteLocalPath: 'src/www',
        tables: tables,
        //messages: topics,

        cdn: {
            useCDN: false
        },
        environmentVariables: {
            LAMBADA_SHOW_ALL_ERRORS: 'true'
        }
    })

export const apiUrl = result.api.url
export const cdnUrl = result.cdn?.domainName