import * as aws from "@pulumi/aws";
import { createLambda, LambdaResource } from '../lambdas'
import { MessagingContext, MessagingResultItem } from ".";
import { Callback } from '@pulumi/aws/lambda';
import { TopicEvent, TopicEventSubscription } from "@pulumi/aws/sns";
import { String } from "aws-sdk/clients/cloudsearch";
import { LambadaResources, EmbroideryEnvironmentVariables } from "..";

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

// const context: MessagingContext = {
//     environment,
//     databases,
//     kmsKeys
// }

export const subscribeToTopic = (context: LambadaResources, topic: MessagingResultItem, subscription: LambdaSubscription): TopicEventSubscription => {
    const environment = context.environment
    const topicName = topic.definition.name
    // policyStatements.push({
    //     Action: [
    //         "cognito-idp:AdminGetUser",
    //         "cognito-idp:ListUsers"
    //     ],
    //     Resource: apiContext.cognitoUserPool.arn,
    //     Effect: "Allow"
    // })
    if (context.kmsKeys && context.kmsKeys.dynamodb) {
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
    if (topic.awsTopic)
        return topic.awsTopic.onEvent(`${topicName}_${subscription.name}_${environment}`, callback)
    else
        // TODO: reference topics
        throw 'REFERENCE TOPICS NOT IMPLEMENTED'
}

export const createTopicAndSubscribe = (
    topicName: string,
    context: MessagingContext,
    subscriptions: LambdaSubscription[]
): aws.sns.Topic => {

    const environment = context.environment
    const databases = context.databases
    const name = `${topicName}-${environment}`
    throw 'NOT IMPLEMENTED'

    for (let index = 0; index < subscriptions.length; index++) {
        const subscription = subscriptions[index];

    }
    /**
     * contentBasedDeduplication: true,
        fifoQueue: true,
     */

    // return topic
} 