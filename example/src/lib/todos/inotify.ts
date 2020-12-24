export interface ITodosNotifications {
    send(item: ToDoItemCreated): Promise<void>
}

export type ToDoItemCreated = {
    id: string
    userId: string
    title: string
    completed: false
}