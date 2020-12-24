import { EmbroideryCallback, EmbroideryRequest, EmbroideryContext, EmbroideryEventHandlerRoute, createEndpointSimpleCors, EmbroideryApiEndpointCreator } from '@attire/core'
import { LambdaResourceAccess } from '@attire/core/dist/lib/lambdas';
import { getBody } from '@attire/core/dist/lib/api/utils'
import { ToDoService } from '../../lib/todos/service';

import { ToDoItem } from '../../lib/todos/todo'

export const postToDo: EmbroideryCallback = async (request: EmbroideryRequest): Promise<object> => {

    // TODO: use a different type and not the entity
    const newItemData = getBody<ToDoItem>(request.request); //TODO: pass embroidery request instead
    
    const newItem = await ToDoService.production().addToDo(newItemData)

    return newItem
}

export const createPostToDo: EmbroideryApiEndpointCreator = (apiContext: EmbroideryContext): EmbroideryEventHandlerRoute => {
    return createEndpointSimpleCors('postToDo', apiContext, '/todos', 'POST', postToDo, [
        {
            table: apiContext.databases?.todos,
            access: [
                LambdaResourceAccess.DynamoDbPutItem,
            ],
        }
    ])
}