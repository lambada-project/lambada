import { describe, expect, test } from 'bun:test'
import type { Context } from 'aws-lambda'
import { getMockRequest, type EmbroideryCallback } from '@lambada/core'
import { createHandler } from '@lambada/utils/handler'
import { getTodos, postTodo } from './todos'

// Handlers are called the way lambada calls them in Lambda, against the table in AWS Emulator.
const call = (callback: EmbroideryCallback, body?: object) =>
    createHandler<Context>(callback)(getMockRequest(true, body).request, {} as Context)

describe('todos API', () => {
    test('GET /todos answers the list and its total', async () => {
        const response = await call(getTodos)

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ items: [], total: 0 })
    })

    test('POST /todos answers 400 to a todo without a title', async () => {
        const response = await call(postTodo, { title: '' })

        expect(response.statusCode).toBe(400)
        expect(JSON.parse(response.body).error).toMatchObject({ code: 'BAD_REQUEST', message: 'A todo needs a title' })
    })
})
