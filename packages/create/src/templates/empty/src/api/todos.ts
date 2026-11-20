import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { EmbroideryCallback } from '@lambada/core'
import { getBody } from '@lambada/utils/request'
import { LambadaError } from '@lambada/utils/error'

// Created on first use, inside Lambda: Pulumi can't serialize a client built at deploy time.
let client: DynamoDBDocumentClient | undefined
const db = () => client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}))

class BadRequest extends LambadaError {
    statusCode = 400
    code = 'BAD_REQUEST'
}

export type Todo = { listId: string, id: string, title: string, done: boolean }

export const health: EmbroideryCallback = async () => ({ ok: true })

export const listTodos: EmbroideryCallback = async ({ request }) => {
    const { Items } = await db().send(new QueryCommand({
        TableName: process.env.TODOS_TABLE,
        KeyConditionExpression: 'listId = :listId',
        ExpressionAttributeValues: { ':listId': request.pathParameters?.listId },
    }))
    return { todos: (Items ?? []) as Todo[] }
}

export const addTodo: EmbroideryCallback = async ({ request }) => {
    const { title } = getBody<{ title?: string }>(request)
    if (!title) throw new BadRequest('A todo needs a title')

    const todo: Todo = { listId: request.pathParameters!.listId!, id: randomUUID(), title, done: false }
    await db().send(new PutCommand({ TableName: process.env.TODOS_TABLE, Item: todo }))
    return { statusCode: 201, body: todo }
}
