import { RepositoryBase } from '@lambada/utils/repository'
import { tables } from '../../resources'
import type { Todo, TodoRepository } from '../todos/todo'

/** A user's total lives beside their todos, under this id. */
const TOTAL_ID = '#total'

type TotalItem = { userId: string, id: typeof TOTAL_ID, value: number }

/** Reads the table's name from TODOS_TABLE, so construct it inside a handler, not at module level. */
export class DynamoTodoRepository extends RepositoryBase implements TodoRepository {
    constructor() {
        super(tables.todos)
    }

    async list(userId: string): Promise<Todo[]> {
        const items = await this.query<Todo | TotalItem>({ name: 'userId', value: userId })
        return items.filter((item): item is Todo => item.id !== TOTAL_ID)
    }

    get(userId: string, id: string): Promise<Todo | null> {
        return this.getById<Todo>({ name: 'userId', value: userId }, { name: 'id', value: id })
    }

    save(todo: Todo): Promise<Todo> {
        return this.upsert(todo)
    }

    async getTotal(userId: string): Promise<number> {
        const total = await this.getById<TotalItem>({ name: 'userId', value: userId }, { name: 'id', value: TOTAL_ID })
        return total?.value ?? 0
    }

    async setTotal(userId: string, value: number): Promise<void> {
        await this.upsert<TotalItem>({ userId, id: TOTAL_ID, value })
    }

    /** One scan page: enough for an example, not for a large table. */
    async all(): Promise<Todo[]> {
        const items = await this.scan<Todo | TotalItem>()
        return items.filter((item): item is Todo => item.id !== TOTAL_ID)
    }
}
