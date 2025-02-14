import { run, createProxyIntegration, createEndpoint } from '@lambada/core'
import createGetToDos from './api/todos/get.js'
import { createPostToDo } from './api/todos/post.js'
import { tables } from './lib/dynamodb-repos/tables.js'
import { topics } from './messages/index.js'
import { createHandlerTodoItem_created } from './messages/todoItem_created.js'
import * as pulumi from '@pulumi/pulumi'

const environment = pulumi.getStack()
const projectName = 'lambada-example'

const result = run(projectName, environment,
    {
        api: {
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
        },
        cors: {
            origins: ['*'],
            headers: ['*']
        },
        messageHandlerDefinitions: [
            createHandlerTodoItem_created
        ],
        staticSiteLocalPath: 'src/www/build',
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

export const apiUrl = result.api?.url
export const cdnUrl = result.cdn?.domainName