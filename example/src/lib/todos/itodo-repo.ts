import { ToDoItem } from "./todo";

export interface IToDoRepository {
    getAll(userId: string): Promise<ToDoItem[]>
    add(item: ToDoItem): Promise<ToDoItem>
    getTotal(userId: string): Promise<number>
    updateTotal (userId: string, value: number) : Promise<void>
}