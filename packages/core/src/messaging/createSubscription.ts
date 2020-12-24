import * as aws from "@pulumi/aws";
import { createLambda, LambdaResource } from '../lambdas'
import { MessagingContext, MessagingResultItem } from ".";
import { Callback } from '@pulumi/aws/lambda';
import { TopicEvent, TopicEventSubscription } from "@pulumi/aws/sns";
import { String } from "aws-sdk/clients/cloudsearch";
import { EmbroideryContext, EmbroideryEnvironmentVariables } from "..";

export type SubscriptionEvent = TopicEvent
export type SubscriptionCallback = Callback<SubscriptionEvent, void>

export type LambdaSubscription = {
    name: string
    callback: SubscriptionCallback
    policyStatements: aws.iam.PolicyStatement[]
    environmentVariables: EmbroideryEnvironmentVariables,
    resources: LambdaResource[]
}

export type LambdaSubscriptionSimple = {
    name: String
    callback: SubscriptionCallback
    resources: LambdaResource[]
}


export const subscribeToTopic = (context: EmbroideryContext, topic: MessagingResultItem, subscription: LambdaSubscription) : TopicEventSubscription => {
    const environment = context.environment
    const topicName = topic.awsTopic.name
    // policyStatements.push({
    //     Action: [
    //         "cognito-idp:AdminGetUser",
    //         "cognito-idp:ListUsers"
    //     ],
    //     Resource: apiContext.cognitoUserPool.arn,
    //     Effect: "Allow"
    // })
    if (context.kmsKeys) {
        subscription.resources.push(
            {
                kmsKey: context.kmsKeys.dynamodb,
                access: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey"
                ],
            })
    }

    const callback = createLambda<TopicEvent, void>(
        subscription.name,
        environment,
        subscription.callback,
        subscription.policyStatements,
        subscription.environmentVariables,
        subscription.resources
    )

    return topic.awsTopic.onEvent(`${topicName}_${subscription.name}_${environment}`, callback)
}

export const createTopicAndSubscribeSimple = (
    topicName: string,
    topicEnvironmentKeyName: string,
    context: MessagingContext,
    subscriptions: LambdaSubscriptionSimple[]
): MessagingResultItem => {

    const subs: LambdaSubscription[] = subscriptions.map(sub => {

        return {
            name: sub.name,
            callback: sub.callback,
            environmentVariables: undefined,
            policyStatements: [],
            resources: sub.resources
        } as LambdaSubscription
    })

    return {
        awsTopic: createTopicAndSubscribe(
            topicName,
            context,
            subs
        ),
        envKeyName: topicEnvironmentKeyName
    }
}

export const createTopicAndSubscribe = (
    topicName: string,
    context: MessagingContext,
    subscriptions: LambdaSubscription[]
): aws.sns.Topic => {

    const environment = context.environment
    const databases = context.databases
    const name = `${topicName}-${environment}`

    const topic = new aws.sns.Topic(name, {
        tags: {
            Environment: environment
        }
    });

    for (let index = 0; index < subscriptions.length; index++) {
        const subscription = subscriptions[index];
        throw 'NOT IMPLEMENTED'

    }
    /**
     * contentBasedDeduplication: true,
        fifoQueue: true,
     */

    return topic
} 