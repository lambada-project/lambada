import * as pulumi from '@pulumi/pulumi'
import { run } from '@lambada/core'
import { messages, queues, tables } from './resources'
import { getTodos, health, postTodo, remindTodo } from './api/todos'
import { onTodoCreated, recomputeTotals, sendReminder } from './events/handlers'

const result = run('lambada-example', pulumi.getStack(), {
    tables,
    messages,
    queues,
    logs: { retention: { days: 14 } },

    api: {
        lambdaDefaultOptions: { memorySize: 256, architecture: 'arm64' },
        endpointDefinitions: [
            {
                name: 'health', path: '/health', method: 'GET', callbackDefinition: health,
                resources: {},
            },
            {
                name: 'getTodos', path: '/todos', method: 'GET', callbackDefinition: getTodos,
                resources: { table: { todos: ['dynamodb:Query', 'dynamodb:GetItem'] } },
            },
            {
                name: 'postTodo', path: '/todos', method: 'POST', callbackDefinition: postTodo,
                resources: {
                    table: { todos: ['dynamodb:PutItem'] },
                    topic: { todoCreated: ['sns:Publish'] },
                },
            },
            {
                name: 'remindTodo', path: '/todos/{id}/remind', method: 'POST', callbackDefinition: remindTodo,
                resources: {
                    table: { todos: ['dynamodb:GetItem'] },
                    queue: { reminders: ['sqs:SendMessage'] },
                },
            },
        ],
    },

    messageHandlerDefinitions: [{
        name: 'onTodoCreated',
        topic: 'todoCreated',
        callback: onTodoCreated,
        resources: { table: { todos: ['dynamodb:GetItem', 'dynamodb:PutItem'] } },
        retries: 2,
    }],

    queueHandlerDefinitions: [{
        name: 'sendReminder',
        queue: 'reminders',
        callback: sendReminder,
        reportBatchItemFailures: true,
        subscriptionArgs: { batchSize: 10 },
        resources: { table: { todos: ['dynamodb:GetItem', 'dynamodb:PutItem'] } },
    }],

    scheduleDefinitions: [{
        name: 'recomputeTotals',
        schedule: { cron: { minute: 0, hour: 3 } },   // 03:00 UTC every day
        callback: recomputeTotals,
        resources: { table: { todos: ['dynamodb:Scan', 'dynamodb:PutItem'] } },
    }],

    // The SPA in src/www, built to src/www/build, served with the API behind one CloudFront distribution,
    // so the browser calls /api on its own origin and needs no CORS.
    staticSiteLocalPath: 'src/www/build',
    cdn: { useCDN: true, isSpa: true },
})

export const apiUrl = result.api?.url
export const siteUrl = result.cdn && pulumi.interpolate`https://${result.cdn.domainName}`
