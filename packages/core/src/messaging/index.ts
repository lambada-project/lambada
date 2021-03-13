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
    // data?: (string | object)[]
}

export type EmbroideryMessages = { [id: string]: MessageDefinition }

export type EmbroideryTopicEventSubscription = TopicEventSubscription
export type EmbroiderySubscriptionCreator = (context: LambadaResources) => EmbroideryTopicEventSubscription

export const createMessaging = (environment: string, messages: EmbroideryMessages, handlers?: EmbroiderySubscriptionCreator[]): MessagingResult => {

    const result: MessagingResult = {}

    for (const key in messages) {
        if (messages.hasOwnProperty(key)) {
            const message = messages[key];            
            const topic = new aws.sns.Topic(message.name, {
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

    // TODO: MessagesRef like we have on the tables

    return result
}

type TopicReference = {
    name: string
    id: string
    arn: string
    hashKey: string;
}

export type MessagingResultItem = {
    awsTopic?: aws.sns.Topic
    envKeyName: string
    ref: pulumi.Output<TopicReference>
    definition: MessageDefinition
}

export type MessagingResult =  { [id: string]: MessagingResultItem }


export type MessagingContext = {
    environment: string
    databases?: DatabaseResult
    kmsKeys?: SecurityResult
}