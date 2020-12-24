import { EmbroideryCallback, EmbroideryRequest, EmbroideryContext, EmbroideryEventHandlerRoute, createEndpointSimpleCors, EmbroideryApiEndpointCreator } from '@attire/core'
import { LambdaResourceAccess } from '@attire/core/dist/lib/lambdas';
import { ToDoService } from "../../lib/todos/service";

export type ToDoItemView = {
    id: string
    title: string
    completed: boolean
}

export const getToDos: EmbroideryCallback = async (request: EmbroideryRequest): Promise<ToDoItemView[]> => {
    const items = await ToDoService.production().getToDos()
    console.log('returning', items)
    return items.map(x => ({ ...x }))
}


export const createGetToDos: EmbroideryApiEndpointCreator = (apiContext: EmbroideryContext): EmbroideryEventHandlerRoute => {
    return createEndpointSimpleCors('getToDos', apiContext, '/todos', 'GET', getToDos, [
        {
            table: apiContext.databases?.todos,
            access: [
                LambdaResourceAccess.DynamoDbScan,
            ],
        }
    ])
}