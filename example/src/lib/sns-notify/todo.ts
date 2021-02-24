import { ITodosNotifications, ToDoItemCreated } from '../todos/inotify'
import { topics } from '../../messages'
import * as AWS from 'aws-sdk'


export class SNSTodosNotifications implements ITodosNotifications {
    private readonly todoItemCreatedTopicARN: string
    
    constructor(){
        this.todoItemCreatedTopicARN = process.env[topics.todoItemCreated.envKeyName] ?? ''
    }

    async send(item: ToDoItemCreated): Promise<void> {
        const sns = new AWS.SNS({ apiVersion: '2010-03-31' });
        console.log('ARN', this.todoItemCreatedTopicARN)
        const result = await sns.publish({
            Message: JSON.stringify(item),
            TopicArn: this.todoItemCreatedTopicARN
        }).promise()
    }
}