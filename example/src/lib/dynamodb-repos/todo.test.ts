import { tables } from './tables'
import { ToDoDynamoDBRepository } from './todo'
import { ConfigureAwsEnvironment, RemoveResources } from '@lambada/core'


describe('todo repos', () => {

    const config = {
        options: {
            tables: tables,
            aws: {
                region: 'local',
                dynamodb: {
                    endpoint: 'http://dynamo:8000'
                }
            }
        }
    }

    beforeAll(async () => {
        await ConfigureAwsEnvironment(config)
    })

    afterAll(async () => {
        await RemoveResources(config)
    })

    it('should be able to create a new todo', async () => {

        const userId = Date.now().toString()
        const repos = new ToDoDynamoDBRepository(config.options.aws.dynamodb)

        const all = await repos.getAll(userId)
        expect(all).toHaveLength(0)

        const todo = await repos.add({
            userId: userId,
            id: 'todo1',
            title: 'todo 1',
            completed: false
        })

        expect(todo).toEqual({
            userId: userId,
            id: 'todo1',
            title: 'todo 1',
            completed: false
        })

        expect(await repos.getAll(userId)).toHaveLength(1)
    })

})