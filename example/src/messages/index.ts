import { LambadaMessages } from '@lambada/core/dist/messaging'

export const topics: LambadaMessages = {
    'todoItemCreated': {
        name: 'todoItemCreated',
        envKeyName: 'TODO_ITEM_CREATED_TOPIC_ARN'
    }
}