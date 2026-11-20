import type { LambadaRunArguments } from '@lambada/core'

// The stack's resources, by the names grants use. Tests import them to create the same table.

export const tables = {
    todos: {
        name: 'todos',
        primaryKey: 'userId',
        rangeKey: 'id',
        envKeyName: 'TODOS_TABLE',
    },
} satisfies LambadaRunArguments['tables']

export const messages = {
    todoCreated: { name: 'todo-created', envKeyName: 'TODO_CREATED_TOPIC' },
} satisfies LambadaRunArguments['messages']

export const queues = {
    // Visibility must cover the handler's timeout (90 seconds by default).
    reminders: { name: 'reminders', envKeyName: 'REMINDERS_QUEUE', options: { visibilityTimeoutSeconds: 180 } },
} satisfies LambadaRunArguments['queues']
