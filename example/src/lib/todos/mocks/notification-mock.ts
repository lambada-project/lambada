import { ITodosNotifications, ToDoItemCreated } from "../inotify"
import { IToDoRepository } from "../itodo-repo";
import { ToDoItem } from "../todo";

export const NotificationsMock = jest.fn<ITodosNotifications, []>(() => {

    const repoMock: ITodosNotifications = {
        send: (item: ToDoItemCreated) => {
            return Promise.resolve()
        }
    }
    return repoMock

})