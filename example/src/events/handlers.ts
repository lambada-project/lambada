import type { QueueHandlerCallback, ScheduleCallback, SubscriptionCallback } from '@lambada/core'
import { todoService } from '../lib/production'
import type { Reminder, TodoCreated } from '../lib/todos/todo'

/** Subscribed to todoCreated: counts each new todo. */
export const onTodoCreated: SubscriptionCallback = async (event) => {
    const service = todoService()
    for (const record of event.Records) {
        const created = JSON.parse(record.Sns.Message) as TodoCreated
        await service.countCreated(created.userId)
    }
}

/** Processes the reminders queue. A failed message returns to the queue on its own. */
export const sendReminder: QueueHandlerCallback = async (event) => {
    const service = todoService()
    const batchItemFailures: { itemIdentifier: string }[] = []

    for (const record of event.Records) {
        try {
            const reminder = JSON.parse(record.body) as Reminder
            console.log(`Reminding ${reminder.userId} about ${reminder.id}`)   // send an email, a push…
            await service.markReminded(reminder.userId, reminder.id)
        } catch (error) {
            console.error(`Reminder ${record.messageId} failed`, error)
            batchItemFailures.push({ itemIdentifier: record.messageId })
        }
    }
    return { batchItemFailures }
}

/** Runs nightly: rebuilds every user's total. */
export const recomputeTotals: ScheduleCallback = async () => {
    const users = await todoService().recomputeTotals()
    console.log(`Recomputed the totals of ${users} users`)
}
