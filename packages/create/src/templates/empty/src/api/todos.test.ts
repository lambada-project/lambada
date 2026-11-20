import { describe, expect, test } from 'bun:test'
import type { Context } from 'aws-lambda'
import { getMockRequest } from '@lambada/core'
import { createHandler } from '@lambada/utils/handler'
import { addTodo, listTodos, type Todo } from './todos'

const request = (listId: string, body?: object) => {
    const mock = getMockRequest(true, body)
    mock.request.pathParameters = { listId }
    return mock
}

describe('todos', () => {
    test('adds a todo and lists it', async () => {
        const created = await addTodo(request('groceries', { title: 'Oat milk' })) as { statusCode: number, body: Todo }
        expect(created.statusCode).toBe(201)

        const listed = await listTodos(request('groceries')) as { todos: Todo[] }
        expect(listed.todos.map(t => t.title)).toContain('Oat milk')
    })

    test('answers 400 to a todo without a title', async () => {
        // createHandler wraps the callback the way lambada does when it deploys it.
        const { request: event } = request('groceries', { done: true })
        const response = await createHandler(addTodo)(event, {} as Context)

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body).error.code).toBe('BAD_REQUEST')
    })
})
