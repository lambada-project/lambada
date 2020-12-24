import { IToDoRepository } from "../irepo";
import { ToDoItem } from "../todo";

export const TodoRepoMock = jest.fn<IToDoRepository, []>(() => {
    const items: ToDoItem[] = []
    const repoMock: IToDoRepository = {
        getAll: () => (Promise.resolve(items)),
        add: (item: ToDoItem) => {
            items.push(item)
            return Promise.resolve(item)
        }
    }
    return repoMock

})