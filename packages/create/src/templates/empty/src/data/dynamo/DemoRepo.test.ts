import { DemoRepo } from "./DemoRepo"

describe('DemoRepo', () => {
    test('CRUD', async () => {
        const repo = new DemoRepo()
        const userItems = await repo.getByUserId('1')
        expect(userItems).toHaveLength(0)
    })
})