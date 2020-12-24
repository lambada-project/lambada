import { IToDoRepository } from "./irepo";
import { ToDoItem } from "./todo";
import { ToDoDynamoDBRepository } from '../dynamodb-repos/todo'
import { SNSTodosNotifications } from '../sns-notify/todo'
import { ITodosNotifications } from './inotify'
import { v4 } from 'uuid'

export class ToDoService {

    constructor(private readonly todos: IToDoRepository, private readonly notify: ITodosNotifications) {

    }

    getToDos = (): Promise<ToDoItem[]> => {
        return this.todos.getAll()
    }

    addToDo = async (item: ToDoItem): Promise<ToDoItem> => {
        item.id = v4()
        item.userId = '1'
        const savedItem = await this.todos.add(item)

        return savedItem
    }

    public static production(){
        const repo = new ToDoDynamoDBRepository()
        const notify = new SNSTodosNotifications();
        return new ToDoService(repo, notify)
    }
}