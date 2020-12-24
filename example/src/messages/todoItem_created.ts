import { SubscriptionEvent, EmbroideryContext, EmbroiderySubscriptionCreator, subscribeToTopic, EmbroideryTopicEventSubscription } from '@attire/core'

export const onTodoItemCreated = async (request: SubscriptionEvent): Promise<void> => {
    console.log('okokok', request)
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
