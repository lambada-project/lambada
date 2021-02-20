import { run, createProxyIntegration } from '@attire/core'
import {} from "@lambada/server"
import { createGetToDos } from './api/todos/get'
import { createPostToDo } from './api/todos/post'
import { tables } from './lib/dynamodb-repos/tables'
import { topics } from './messages'
import { createHandlerTodoItem_created } from './messages/todoItem_created'

const result = run('embroidery-example', 'dev',
    {
        endpointDefinitions: [
            createGetToDos,
            createPostToDo,
            (context) => createProxyIntegration(context, '/google', "https://www.google.com")
        ],
        createOptionsForCors: true,
        messageHandlerDefinitions: [createHandlerTodoItem_created],
        staticSiteLocalPath: 'src/www',
        tables: tables,
        messages: topics,
        cdn: {
            useCDN: true
        }
    })

export const apiUrl = result.api.url
export const cdnUrl = result.cdn?.domainName