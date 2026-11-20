import type { LambadaRunArguments } from '@lambada/core'

/**
 * The stack's resources, by the name grants use. Kept apart from index.ts so tests can create the
 * same resources in AWS Emulator.
 */
export const tables = {
    todos: {
        name: 'todos',
        primaryKey: 'listId',
        rangeKey: 'id',
        envKeyName: 'TODOS_TABLE',
    },
} satisfies LambadaRunArguments['tables']
