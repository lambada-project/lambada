import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { TopicEventSubscription } from "@pulumi/aws/sns";
import * as awsx from "@pulumi/awsx";
import { LambadaResources } from "..";

import { DatabaseResult } from "../database";
import { SecurityResult } from "../security";

export * from './createSubscription'

export type MessageDefinition = {
    name: string
    envKeyName: string
    deliveryPolicy?: {
        http?: {
            defaultHealthyRetryPolicy?: {
                /**
                 * The minimum delay for a retry. Unit: Seconds
                 */
                minDelayTarget?: number,
                /**
                * The maximum delay for a retry. Unit: Seconds
                */
                maxDelayTarget?: number,
                /**
                *  The total number of retries, including immediate, pre-backoff, backoff, and post-backoff retries
                */
                numRetries?: number,
                /**
                * The number of retries in the post-backoff phase, with the maximum delay between them.	
                */
                numMaxDelayRetries?: number,
                /**
                * The number of retries to be done immediately, with no delay between them.	
                */
                numNoDelayRetries?: number,
                /**
                * The number of retries in the pre-backoff phase, with the specified minimum delay between them.
                */
                numMinDelayRetries?: number,
                /**
                * The model for backoff between retries. Values: arithmetic, exponential, geometric, linear
                */
                backoffFunction?: "linear" | "arithmetic" | "exponential" | "geometric"

            },
            /**
             * Apply this policy to all subscriptions, even if they have their own policies.
             */
            disableSubscriptionOverrides?: false,
            defaultThrottlePolicy?: {
                /**
                 * The maximum number of deliveries per second, per subscription.	
                 */
                maxReceivesPerSecond?: 1
            }
        }
    }
}

export type EmbroideryMessages = { [id: string]: MessageDefinition }

export type EmbroideryTopicEventSubscription = TopicEventSubscription
export type EmbroiderySubscriptionCreator = (context: LambadaResources) => EmbroideryTopicEventSubscription

const tryParse = (value: any) => {
    if (!value) return undefined
    try {
        return JSON.stringify(value, undefined, 2));
    }
    catch (e) {
        console.error(`Failed to parse delivery policy. ${(e as any)?.message}. ${JSON.stringify(value, undefined, 2)}`);
        return undefined;
    }
};

export const createMessaging = (
    environment: string,
    messages?: EmbroideryMessages,
    handlers?: EmbroiderySubscriptionCreator[],
    messagesRef?: EmbroideryMessages
): MessagingResult => {

    const result: MessagingResult = {}

    for (const key in messages) {
        if (messages.hasOwnProperty(key)) {
            const message = messages[key];
            const name = `${message.name}-${environment}`
            const topic = new aws.sns.Topic(message.name, {
                name: name,
                deliveryPolicy: tryParse(message.deliveryPolicy),
                tags: {
                    Environment: environment
                }
            });

            result[key] = {
                awsTopic: topic,
                envKeyName: message.envKeyName,
                ref: {
                    arn: topic.arn,
                    id: topic.id,
                    name: topic.name
                },
                definition: message
            } as MessagingResultItem
        }
    }

    for (const key in messagesRef) {
        if (Object.prototype.hasOwnProperty.call(messagesRef, key)) {
            const message = messagesRef[key];
            if (result[key]) {
                throw new Error(`Cannot create a ref message with the same name of an existing topic: ${key}`)
            }
            const topic = findTopic(message.name, environment)

            result[key] = {
                awsTopic: aws.sns.Topic.get(`${message.name}-${environment}`, topic.id),
                envKeyName: message.envKeyName,
                ref: topic,
                definition: message
            } as MessagingResultItem
        }
    }

    return result
}

function findTopic(name: string, environment: string): pulumi.Output<TopicReference> {
    const topicName = `${name}-${environment}`
    return pulumi.output(aws.sns.getTopic({
        name: topicName,
    }, { async: true }));
}

type TopicReference = {
    name: string
    id: string
    arn: string
}

export type MessagingResultItem = {
    awsTopic?: aws.sns.Topic
    envKeyName: string
    ref: pulumi.Output<TopicReference>
    definition: MessageDefinition
}

export type MessagingResult = { [id: string]: MessagingResultItem }


export type MessagingContext = {
    environment: string
    databases?: DatabaseResult
    kmsKeys?: SecurityResult
}