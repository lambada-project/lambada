import { SubscriptionEvent, EmbroideryContext, EmbroiderySubscriptionCreator, subscribeToTopic, EmbroideryTopicEventSubscription } from '@attire/core'
import { ToDoItemCreated } from '../lib/todos/inotify'
import { ToDoService } from '../lib/todos/service'

export const onTodoItemCreated = async (request: SubscriptionEvent): Promise<void> => {
    for (const item of request.Records) {
        const message = JSON.parse(item.Sns.Message) as ToDoItemCreated
        const todos = ToDoService.production()
        const total = await todos.getTotal(message.userId)
        await todos.updateTotals(message.userId, total + 1)
    }
}


export const createHandlerTodoItem_created: EmbroiderySubscriptionCreator = (context: EmbroideryContext): EmbroideryTopicEventSubscription => {
    if (context.messaging?.todoItemCreated)
        return subscribeToTopic(context, context.messaging.todoItemCreated, {
            name: 'onTodoItemCreated',
            callback: onTodoItemCreated,
            policyStatements: [],
            environmentVariables: {},
            resources: []

        })
    else
        throw 'todoItemNotFound'
}
