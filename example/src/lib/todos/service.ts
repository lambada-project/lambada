import { IToDoRepository } from "./itodo-repo"
import { ToDoItem } from "./todo"

import { ToDoDynamoDBRepository } from '../dynamodb-repos/todo'
import { SNSTodosNotifications } from '../sns-notify/todo'
import { ITodosNotifications } from './inotify'
import { v4 } from 'uuid'

export class ToDoService {

    constructor(
        private readonly todos: IToDoRepository,
        private readonly notify: ITodosNotifications
    ) {

    }

    getToDos = (userId: string): Promise<ToDoItem[]> => {
        return this.todos.getAll(userId)
    }

    addToDo = async (item: ToDoItem): Promise<ToDoItem> => {
        item.id = v4()
        item.userId = '1'
        const savedItem = await this.todos.add(item)
        await this.notify.send({
            ...savedItem
        })
        return savedItem
    }

    getTotal = (userId: string): Promise<number> => {
        return this.todos.getTotal(userId)
    }

    updateTotals = (userId: string, value: number): Promise<void> => {
        return this.todos.updateTotal(userId, value)
    }

    public static production() {
        const todosRepo = new ToDoDynamoDBRepository()
        const notify = new SNSTodosNotifications();
        return new ToDoService(todosRepo, notify)
    }
}