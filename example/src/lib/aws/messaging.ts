import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import type { Reminder, ReminderQueue, TodoCreated, TodoEvents } from '../todos/todo'

// Clients are created on first use, inside Lambda: Pulumi can't serialize one built at deploy time.
let sns: SNSClient | undefined
let sqs: SQSClient | undefined

/** Publishes to the topic granted as TODO_CREATED_TOPIC. */
export class SnsTodoEvents implements TodoEvents {
    async created(event: TodoCreated): Promise<void> {
        sns ??= new SNSClient({})
        await sns.send(new PublishCommand({
            TopicArn: process.env.TODO_CREATED_TOPIC,
            Message: JSON.stringify(event),
        }))
    }
}

/** Sends to the queue granted as REMINDERS_QUEUE. */
export class SqsReminderQueue implements ReminderQueue {
    async send(reminder: Reminder): Promise<void> {
        sqs ??= new SQSClient({})
        await sqs.send(new SendMessageCommand({
            QueueUrl: process.env.REMINDERS_QUEUE,
            MessageBody: JSON.stringify(reminder),
        }))
    }
}
