import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { QueueArgs, QueueEventSubscription } from "@pulumi/aws/sqs";
import * as awsx from "@pulumi/awsx";
import { LambadaResources } from "..";

import { DatabaseResult } from "../database";
import { SecurityResult } from "../security";
import { LambdaQueueHandler } from "./createQueueHandler";

//export * from './createSubscription'

export type QueueDefinition = {
    name: string
    envKeyName: string
    options?: QueueArgs
}

export type LambadaQueues = { [id: string]: QueueDefinition }

export type LambadaQueueHandleSubscription = QueueEventSubscription
export type LambadaQueueSubscriptionCreator = (context: LambadaResources) => LambdaQueueHandler


export const createQueues = (
    environment: string,
    queues?: LambadaQueues,
    queuesRef?: LambadaQueues
) => {
    const result: QueuesResult = {}


    for (const key in queues) {
        if (queues.hasOwnProperty(key)) {
            const queueDef = queues[key];
            const name = `${queueDef.name}-${environment}`
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
                    name: queue.name
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
            const queue = findQueue(queueRef.name, environment)

            result[key] = {
                awsQueue: aws.sqs.Queue.get(`${queueRef.name}-${environment}`, queue.id),
                envKeyName: queueRef.envKeyName,
                ref: queue,
                definition: queueRef
            } as QueueResultItem
        }
    }

    return result
}


function findQueue(name: string, environment: string): pulumi.Output<QueueReference> {
    const topicName = `${name}-${environment}`

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

    return pulumi.output(getQueue(topicName));
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