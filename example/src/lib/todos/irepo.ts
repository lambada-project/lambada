import { ToDoItem } from "./todo";

export interface IToDoRepository {
    getAll(): Promise<ToDoItem[]>
    add(item: ToDoItem): Promise<ToDoItem>
}