import { getMockRequest, ConfigureAwsEnvironment } from '@attire/core/dist/lib'

import { getToDos, ToDoItemView } from './get'
import { postToDo } from './post'

import { tables } from '../../lib/dynamodb-repos/tables'
import { ToDoItem } from '../../lib/todos/todo'

beforeAll(async () => {
    await ConfigureAwsEnvironment(tables)
})

test('lambda => postToDos', async () => {
    const initialTodos: ToDoItemView[] = (await getToDos(getMockRequest(false))) as any //BBBRRR
    const initialLength = initialTodos.length;

    const newItemData = {
        title: 'Something to do',
        completed: false
    } 
    
    const newItem = await postToDo(getMockRequest(false, newItemData))

    expect(newItem).toBeTruthy()

    const currentTodos: ToDoItemView[] = (await getToDos(getMockRequest(false))) as any //BBBRRR
    const currentLength = currentTodos.length;

    expect(currentLength).toBeGreaterThan(initialLength)
});