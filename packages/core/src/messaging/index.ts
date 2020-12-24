import * as aws from "@pulumi/aws";
import { TopicEventSubscription } from "@pulumi/aws/sns";
import * as awsx from "@pulumi/awsx";
import { EmbroideryContext } from "..";

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
export type EmbroiderySubscriptionCreator = (context: EmbroideryContext) => EmbroideryTopicEventSubscription

export const createMessaging = (environment: string, messages: EmbroideryMessages , databases?: DatabaseResult, kmsKeys?: SecurityResult): MessagingResult => {
    const context: MessagingContext = {
        environment,
        databases,
        kmsKeys
    }

    const result: any = {}
    for (const key in messages) {
        if (messages.hasOwnProperty(key)) {
            const message = messages[key];
            
            
        }
    }

    return {
       
    }
}

export type MessagingResultItem = {
    awsTopic: aws.sns.Topic
    envKeyName: string
    //kmsKey: aws.kms.Key
}

export type MessagingResult =  { [id: string]: MessagingResultItem }


export type MessagingContext = {
    environment: string
    databases?: DatabaseResult
    kmsKeys?: SecurityResult
}