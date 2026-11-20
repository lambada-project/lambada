import { TodoService } from './todos/service'
import { DynamoTodoRepository } from './aws/todo-repository'
import { SnsTodoEvents, SqsReminderQueue } from './aws/messaging'

/** The service with its AWS adapters. Call it inside a handler: the adapters read their environment. */
export const todoService = () => new TodoService(new DynamoTodoRepository(), new SnsTodoEvents(), new SqsReminderQueue())
