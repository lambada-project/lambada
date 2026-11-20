import { describe, expect, test } from 'bun:test'
import { BadRequest, NotFound, TodoService } from './service'
import type { Reminder, Todo, TodoCreated, TodoRepository } from './todo'

// The service is plain TypeScript, so these tests use in-memory fakes and need no AWS.

class MemoryTodos implements TodoRepository {
    todos = new Map<string, Todo>()
    totals = new Map<string, number>()
    async list(userId: string) { return [...this.todos.values()].filter(t => t.userId === userId) }
    async get(userId: string, id: string) { return this.todos.get(`${userId}/${id}`) ?? null }
    async save(todo: Todo) { this.todos.set(`${todo.userId}/${todo.id}`, todo); return todo }
    async getTotal(userId: string) { return this.totals.get(userId) ?? 0 }
    async setTotal(userId: string, total: number) { this.totals.set(userId, total) }
    async all() { return [...this.todos.values()] }
}

const setup = () => {
    const todos = new MemoryTodos()
    const created: TodoCreated[] = []
    const reminders: Reminder[] = []
    const service = new TodoService(
        todos,
        { created: async event => { created.push(event) } },
        { send: async reminder => { reminders.push(reminder) } },
    )
    return { service, todos, created, reminders }
}

describe('TodoService', () => {
    test('adds a todo and announces it', async () => {
        const { service, created } = setup()
        const todo = await service.add('ana', '  Oat milk ')

        expect(todo).toMatchObject({ userId: 'ana', title: 'Oat milk', completed: false })
        expect(created).toEqual([{ userId: 'ana', id: todo.id, title: 'Oat milk' }])
    })

    test('refuses a todo without a title', async () => {
        const { service } = setup()
        expect(service.add('ana', '   ')).rejects.toBeInstanceOf(BadRequest)
    })

    test('counts created todos, and recomputes the counts from the todos', async () => {
        const { service, todos } = setup()
        await service.add('ana', 'One')
        await service.add('ana', 'Two')
        await service.countCreated('ana')   // one count lost, as when a delivery fails

        expect((await service.list('ana')).total).toBe(1)
        await service.recomputeTotals()
        expect(await todos.getTotal('ana')).toBe(2)
    })

    test('queues a reminder for an existing todo only', async () => {
        const { service, reminders } = setup()
        const todo = await service.add('ana', 'Call mum')

        await service.remind('ana', todo.id)
        expect(reminders).toEqual([{ userId: 'ana', id: todo.id }])
        expect(service.remind('ana', 'missing')).rejects.toBeInstanceOf(NotFound)
    })

    test('marks a todo reminded', async () => {
        const { service, todos } = setup()
        const todo = await service.add('ana', 'Call mum')

        await service.markReminded('ana', todo.id, new Date('2026-01-01T09:00:00Z'))
        expect((await todos.get('ana', todo.id))?.remindedAt).toBe('2026-01-01T09:00:00.000Z')
    })
})
