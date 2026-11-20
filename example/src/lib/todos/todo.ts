export type Todo = {
    userId: string
    id: string
    title: string
    completed: boolean
    remindedAt?: string
}

export type TodoCreated = Pick<Todo, 'userId' | 'id' | 'title'>

export type Reminder = Pick<Todo, 'userId' | 'id'>

/** Where the todos live. */
export interface TodoRepository {
    list(userId: string): Promise<Todo[]>
    get(userId: string, id: string): Promise<Todo | null>
    save(todo: Todo): Promise<Todo>
    getTotal(userId: string): Promise<number>
    setTotal(userId: string, total: number): Promise<void>
    /** Every todo of every user. */
    all(): Promise<Todo[]>
}

/** What the service tells the rest of the system. */
export interface TodoEvents {
    created(event: TodoCreated): Promise<void>
}

export interface ReminderQueue {
    send(reminder: Reminder): Promise<void>
}
