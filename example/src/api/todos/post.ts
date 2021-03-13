import { EmbroideryCallback, EmbroideryRequest, LambadaResources, EmbroideryEventHandlerRoute, createEndpointSimpleCors, EmbroideryApiEndpointCreator } from '@lambada/core'
import { LambdaResourceAccess } from '@lambada/core/dist/lib/lambdas';
import { getBody } from '@lambada/utils'
import { ToDoService } from '../../lib/todos/service';

import { ToDoItem } from '../../lib/todos/todo'

export const postToDo: EmbroideryCallback = async (request: EmbroideryRequest): Promise<object> => {

    // TODO: use a different type and not the entity
    const newItemData = getBody<ToDoItem>(request.request); //TODO: pass embroidery request instead
    newItemData.userId = '1'
    const newItem = await ToDoService.production().addToDo(newItemData)

    return newItem
}

export const createPostToDo: EmbroideryApiEndpointCreator = (context: LambadaResources): EmbroideryEventHandlerRoute => {
    return createEndpointSimpleCors('postToDo', context, '/todos', 'POST', postToDo, [
        {
            table: context.databases?.todos,
            access: [
                LambdaResourceAccess.DynamoDbPutItem,
            ],
        },
        {
            topic: context.messaging?.todoItemCreated,
            access: [
                "sns:Publish"
            ]
        }
    ])
}