import { EmbroideryMessages } from '@lambada/core/dist/messaging'

export const topics: EmbroideryMessages = {
    'todoItemCreated': {
        name: 'todoItemCreated',
        envKeyName: 'TODO_ITEM_CREATED_TOPIC_ARN'
    }
}