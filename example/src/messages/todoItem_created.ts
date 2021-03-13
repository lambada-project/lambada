import { SubscriptionEvent, LambadaResources, EmbroiderySubscriptionCreator, subscribeToTopic, EmbroideryTopicEventSubscription } from '@attire/core'
import { ToDoItemCreated } from '../lib/todos/inotify'
import { ToDoService } from '../lib/todos/service'
import { LambdaResourceAccess } from '@attire/core/dist/lib/lambdas';


export const onTodoItemCreated = async (request: SubscriptionEvent): Promise<void> => {
    for (const item of request.Records) {
        const message = JSON.parse(item.Sns.Message) as ToDoItemCreated
        const todos = ToDoService.production()
        const total = await todos.getTotal(message.userId)
        await todos.updateTotals(message.userId, total + 1)
    }
}


export const createHandlerTodoItem_created: EmbroiderySubscriptionCreator = (context: LambadaResources): EmbroideryTopicEventSubscription => {
    if (context.messaging?.todoItemCreated)
        return subscribeToTopic(context, context.messaging.todoItemCreated, {
            name: 'onTodoItemCreated',
            callback: onTodoItemCreated,
            policyStatements: [],
            environmentVariables: {},
            resources: [
                {
                    table: context.databases?.todos,
                    access: [
                        LambdaResourceAccess.DynamoDbPutItem,
                        LambdaResourceAccess.DynamoDbGetItem,
                    ],
                },
            ]

        })
    else
        throw 'todoItemNotFound'
}
