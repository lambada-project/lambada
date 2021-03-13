import { IToDoRepository } from '../todos/itodo-repo'
import { ToDoItem } from '../todos/todo'

import { RepositoryBase } from '@lambada/core/dist/lib/database/repository'

import { tables } from './tables'

export class ToDoDynamoDBRepository extends RepositoryBase implements IToDoRepository {

    constructor() {
        super(tables['todos'])
    }

    getAll(userId: string): Promise<ToDoItem[]> {
        return this.query({
            name: 'userId',
            value: userId
        })
    }

    add(item: ToDoItem): Promise<ToDoItem> {
        return this.upsert(item)
    }

    async getTotal(userId: string): Promise<number> {
        const totals = await this.getById<{
            value: number
        }>({
            name: 'userId',
            value: userId,
        }, {
            name: 'id',
            value: 'totals'
        })

        return totals?.value ?? 0
    }

    async updateTotal(userId: string, value: number): Promise<void> {
        await this.upsert({
            userId: userId,
            id: 'totals',
            value: value
        })
    }
}