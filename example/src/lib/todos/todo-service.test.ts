import { ToDoService } from './service'

import { TodoRepoMock } from './mocks/repo-mock'

test('get items', async () => {
    const service = new ToDoService(TodoRepoMock())
    const todos = await service.getToDos()
    expect(todos.length).toBe(0)

    await service.addToDo({
        id: '1',
        userId: '1',
        title: "Test",
        completed: false,
    })

    expect(todos.length).toBe(1)

});