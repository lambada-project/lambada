import type { EmbroideryCallback, EmbroideryRequest } from '@lambada/core'
import { getBody } from '@lambada/utils/request'
import { todoService } from '../lib/production'

/** The example has no sign-in: everyone shares one list unless an authorizer names the caller. */
export const DEMO_USER = 'demo'
const userOf = ({ user }: EmbroideryRequest) => user?.userId ?? DEMO_USER

export const health: EmbroideryCallback = async () => ({ ok: true })

/** GET /todos */
export const getTodos: EmbroideryCallback = async (event) =>
    todoService().list(userOf(event))

/** POST /todos { title } */
export const postTodo: EmbroideryCallback = async (event) => {
    const { title } = getBody<{ title?: string }>(event.request)
    const todo = await todoService().add(userOf(event), title)
    return { statusCode: 201, body: todo }
}

/** POST /todos/{id}/remind: queues a reminder, which a queue handler delivers. */
export const remindTodo: EmbroideryCallback = async (event) => {
    await todoService().remind(userOf(event), event.request.pathParameters!.id!)
    return { statusCode: 202, body: { queued: true } }
}
