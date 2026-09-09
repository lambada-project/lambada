import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { QueueArgs, QueueEventSubscription } from "@pulumi/aws/sqs";
import * as awsx from "@pulumi/awsx/classic";
import { LambadaResources } from "..";

import { DatabaseResult } from "../database";
import { SecurityResult } from "../security";
import { createQueueHandler, LambdaQueueHandler } from "./createQueueHandler";
import { asCreator, LambadaDefinition } from "../resources/creators";
import { lift } from "../inputs";

export * from './createQueueHandler'

export type QueueDefinition = {
    name: string
    envKeyName: string
    options?: QueueArgs
}

export type LambadaQueues = { [id: string]: QueueDefinition }

export type LambadaQueueHandleSubscription = QueueEventSubscription
export type LambadaQueueSubscriptionCreator = (context: LambadaResources) => LambdaQueueHandler

export type LambadaQueueHandlerDefinition = LambadaDefinition<LambdaQueueHandler<any>>

export const createQueueHandlers = (
    context: LambadaResources,
    definitions?: readonly LambadaQueueHandlerDefinition[]
): QueueEventSubscription[] =>
    (definitions ?? []).map(definition => createQueueHandler(context, asCreator<LambdaQueueHandler<any>>(definition)(context)))


export const createQueues = (
    environment: string,
    queues?: LambadaQueues,
    queuesRef?: LambadaQueues | QueuesResult
) => {
    const result: QueuesResult = {}


    for (const key in queues) {
        if (queues.hasOwnProperty(key)) {
            const queueDef = queues[key];
            // Same reason as findQueue: the suffix depends on a value that may not have resolved,
            // and SQS requires it exactly when the queue is fifo.
            const name = lift(
                queueDef.options?.fifoQueue,
                isFifo => `${queueDef.name}-${environment}${isFifo ? '.fifo' : ''}`
            )
            const queue = new aws.sqs.Queue(queueDef.name, {
                ...(queueDef.options ?? {}),
                name: name,
                tags: {
                    Environment: environment
                }
            });

            result[key] = {
                awsQueue: queue,
                envKeyName: queueDef.envKeyName,
                ref: {
                    arn: queue.arn,
                    id: queue.id,
                    name: queue.name,
                    url: queue.url
                },
                definition: queueDef
            } as QueueResultItem
        }
    }

    for (const key in queuesRef) {
        if (Object.prototype.hasOwnProperty.call(queuesRef, key)) {
            const queueRef = queuesRef[key];
            if (result[key]) {
                throw new Error(`Cannot create a ref message with the same name of an existing topic: ${key}`)
            }

            function isRef(obj: any): obj is QueueResultItem {
                return obj.awsQueue && obj.ref
            }

            if (isRef(queueRef)) {
                result[key] = queueRef
            }
            else {
                const queue = findQueue(queueRef.name, environment, queueRef.options?.fifoQueue)

                result[key] = {
                    awsQueue: aws.sqs.Queue.get(`${queueRef.name}-${environment}`, queue.id),
                    envKeyName: queueRef.envKeyName,
                    ref: queue,
                    definition: queueRef
                } satisfies QueueResultItem
            }

        }
    }

    return result
}


function findQueue(
    name: string,
    environment: string,
    fifoQueue: pulumi.Input<boolean | undefined>
): pulumi.Output<QueueReference> {
    const getQueue = async (name: string) => {
        try {
            const topic = await aws.sqs.getQueue({
                name: name,
            }, { async: true })
            return topic
        } catch (e) {
            console.error('Failed to get queue', name);
            throw e
        }

    }

    // `fifoQueue` may not have resolved yet, so the name is built where its value is known. Testing
    // the Input directly made every referenced queue a .fifo one, an object being truthy.
    return lift(fifoQueue, isFifo => getQueue(`${name}-${environment}${isFifo ? '.fifo' : ''}`));
}

type QueueReference = {
    name: string
    id: string
    arn: string
    url: string
}

export type QueueResultItem = {
    awsQueue: aws.sqs.Queue
    envKeyName: string
    ref: pulumi.Output<QueueReference>
    definition: QueueDefinition
}

export type QueuesResult = { [id: string]: QueueResultItem }


export type QueuesContext = {
    environment: string
    databases?: DatabaseResult
    kmsKeys?: SecurityResult
}
