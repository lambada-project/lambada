import { randomUUID } from 'node:crypto'
import { LambadaError } from '@lambada/utils/error'
import type { ReminderQueue, Todo, TodoEvents, TodoRepository } from './todo'

export class NotFound extends LambadaError {
    statusCode = 404
    code = 'NOT_FOUND'
}

export class BadRequest extends LambadaError {
    statusCode = 400
    code = 'BAD_REQUEST'
}

/** The application, free of AWS: handlers build it with real adapters, tests with fakes. */
export class TodoService {
    constructor(
        private readonly todos: TodoRepository,
        private readonly events: TodoEvents,
        private readonly reminders: ReminderQueue,
    ) { }

    async list(userId: string) {
        const [items, total] = await Promise.all([this.todos.list(userId), this.todos.getTotal(userId)])
        return { items, total }
    }

    async add(userId: string, title: string | undefined): Promise<Todo> {
        if (!title?.trim()) throw new BadRequest('A todo needs a title')

        const todo = await this.todos.save({ userId, id: randomUUID(), title: title.trim(), completed: false })
        await this.events.created({ userId, id: todo.id, title: todo.title })
        return todo
    }

    /** Counts a created todo. Runs from the topic subscription, so a slow count never slows the API. */
    async countCreated(userId: string): Promise<void> {
        await this.todos.setTotal(userId, await this.todos.getTotal(userId) + 1)
    }

    async remind(userId: string, id: string): Promise<void> {
        if (!await this.todos.get(userId, id)) throw new NotFound(`Todo ${id} does not exist`)
        await this.reminders.send({ userId, id })
    }

    async markReminded(userId: string, id: string, at = new Date()): Promise<void> {
        const todo = await this.todos.get(userId, id)
        if (!todo) return   // deleted since: nothing to remind
        await this.todos.save({ ...todo, remindedAt: at.toISOString() })
    }

    /** Rebuilds every user's total from their todos, correcting any count a failure left behind. */
    async recomputeTotals(): Promise<number> {
        const totals = new Map<string, number>()
        for (const todo of await this.todos.all()) {
            totals.set(todo.userId, (totals.get(todo.userId) ?? 0) + 1)
        }
        for (const [userId, total] of totals) await this.todos.setTotal(userId, total)
        return totals.size
    }
}
