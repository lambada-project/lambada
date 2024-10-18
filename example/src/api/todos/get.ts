import { EmbroideryCallback, EmbroideryRequest, LambadaResources, LambadaEndpointCreator, LambadaEndpointArgs, LambdaResourceAccess } from '@lambada/core'
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

export const handler: EmbroideryCallback = async (request: EmbroideryRequest): Promise<ToDosView> => {
    const todos = ToDoService.production()

    const items = await todos.getToDos('1')
    const total = await todos.getTotal('1')

    return {
        items: items.map(x => ({ ...x })),
        total: total
    }
}


export default (apiContext: LambadaResources): LambadaEndpointArgs => {
    
    return {
        name: 'lambada-example-todos-get',
        path: '/todos',
        method: 'GET',
        useBundle: '/workspace/example/src/api/todos/get.ts', //import.meta.url,
        callbackDefinition: handler,
        resources: [
            {
                table: apiContext.databases?.todos,
                access: [
                    LambdaResourceAccess.DynamoDbQuery,
                    LambdaResourceAccess.DynamoDbGetItem,
                ],
            }
        ]
    }
}