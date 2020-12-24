import { getMockRequest, ConfigureAwsEnvironment } from '@attire/core/dist/lib'

import { getToDos, ToDoItemView } from './get'

import { tables } from '../../lib/dynamodb-repos/tables'

beforeAll(async () => {
    await ConfigureAwsEnvironment(tables)
})

test('lambda => getToDos', async () => {
    const initialTodos: ToDoItemView[] = (await getToDos(getMockRequest(false))) as any //BBBRRR
    expect(initialTodos).toBeTruthy()
    
    const initialLength = initialTodos.length;
    expect(initialLength).toBeGreaterThanOrEqual(0)
});