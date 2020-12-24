import { IToDoRepository } from '../todos/irepo'
import { ToDoItem } from '../todos/todo'

import { RepositoryBase } from '@attire/core/dist/lib/database/repository'

import { tables } from './tables'

export class ToDoDynamoDBRepository extends RepositoryBase implements IToDoRepository {

    constructor() {
        super(tables['todos'])
    }

    getAll(): Promise<ToDoItem[]> {
        return this.scan()
    }

    add(item: ToDoItem): Promise<ToDoItem> {
        return this.upsert(item)
    }
}