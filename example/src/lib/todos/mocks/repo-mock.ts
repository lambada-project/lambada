import { IToDoRepository } from "../itodo-repo";
import { ToDoItem } from "../todo";

export const TodoRepoMock = jest.fn<IToDoRepository, []>(() => {
    const items: ToDoItem[] = []
    let total: number

    const repoMock: IToDoRepository = {
        getAll: (userId: string) => (Promise.resolve(items)),
        add: (item: ToDoItem) => {
            items.push(item)
            return Promise.resolve(item)
        },
        updateTotal: (userId: string, value: number) => {
            total = value
            return Promise.resolve()
        },
        getTotal: (userId: string) => Promise.resolve(total)
    }
    return repoMock

})