import { describe, expect, test } from 'bun:test'
import { DynamoTodoRepository } from './todo-repository'

// Runs against the table test/setup.ts creates in AWS Emulator.

describe('DynamoTodoRepository', () => {
    test('saves, reads and lists todos apart from the total', async () => {
        const repo = new DynamoTodoRepository()
        const userId = `repo-${Date.now()}`

        expect(await repo.list(userId)).toEqual([])

        const todo = { userId, id: 't1', title: 'Oat milk', completed: false }
        await repo.save(todo)
        await repo.setTotal(userId, 1)

        expect(await repo.get(userId, 't1')).toEqual(todo)
        expect(await repo.list(userId)).toEqual([todo])
        expect(await repo.getTotal(userId)).toBe(1)
        expect((await repo.all()).some(t => t.id === '#total')).toBe(false)
    })
})
