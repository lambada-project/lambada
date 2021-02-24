import { EmbroideryCallback, EmbroideryRequest, EmbroideryContext, EmbroideryEventHandlerRoute, createEndpointSimpleCors, EmbroideryApiEndpointCreator } from '@attire/core'
import { LambdaResourceAccess } from '@attire/core/dist/lib/lambdas';

import { ToDoService } from "../../lib/todos/service";

export type ToDoItemView = {
    id: string
    title: string
    completed: boolean
}

export type ToDosView = {
    items: ToDoItemView[]
    total: number
}

export const getToDos: EmbroideryCallback = async (request: EmbroideryRequest): Promise<ToDosView> => {
    const todos = ToDoService.production()

    const items = await todos.getToDos('1')
    const total = await todos.getTotal('1')

    return { 
        items: items.map(x => ({ ...x })) ,
        total: total
    }
}


export const createGetToDos: EmbroideryApiEndpointCreator = (apiContext: EmbroideryContext): EmbroideryEventHandlerRoute => {
    return createEndpointSimpleCors('getToDos', apiContext, '/todos', 'GET', getToDos, [
        {
            table: apiContext.databases?.todos,
            access: [
                LambdaResourceAccess.DynamoDbQuery,
                LambdaResourceAccess.DynamoDbGetItem,
            ],
        }
    ])
}