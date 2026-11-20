import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'
import { tables } from './resources'
import { addTodo, health, listTodos } from './api/todos'

const result = run(pulumi.getProject(), pulumi.getStack(), {
    tables,
    api: {
        endpointDefinitions: [
            {
                name: 'health',
                path: '/health',
                method: 'GET',
                callbackDefinition: health,
                resources: {},
            },
            {
                name: 'listTodos',
                path: '/lists/{listId}/todos',
                method: 'GET',
                callbackDefinition: listTodos,
                resources: { table: { todos: ['dynamodb:Query'] } },
            },
            {
                name: 'addTodo',
                path: '/lists/{listId}/todos',
                method: 'POST',
                callbackDefinition: addTodo,
                resources: { table: { todos: ['dynamodb:PutItem'] } },
            },
        ],
    },
})

export const apiUrl = result.api?.url
