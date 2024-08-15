import * as aws from "@pulumi/aws";
import { QueueResultItem } from "."
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from ".."
import { createLambda, LambdaOptions, LambdaResource } from '../lambdas'

import { Callback } from '@pulumi/aws/lambda';
import { QueueEvent, QueueEventSubscription, QueueEventSubscriptionArgs } from "@pulumi/aws/sqs";

export type QueueHandlerEvent = QueueEvent
export type QueueHandlerCallback = Callback<QueueHandlerEvent, void>

export type LambdaQueueHandler = {
    name: string
    queue: QueueResultItem
    callback: QueueHandlerCallback
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables,
    resources: LambdaResource[]
    lambdaOptions?: LambdaOptions,
    subscriptionArgs: QueueEventSubscriptionArgs | undefined
}


export const createQueueHandler = (
    context: LambadaResources,
    queueHandler: LambdaQueueHandler,
): QueueEventSubscription => {
    const environment = context.environment
    const queue = queueHandler.queue
    const topicName = queue.definition.name

    if (context.kmsKeys && context.kmsKeys.dynamodb) {
        queueHandler.resources.push(
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

    queueHandler.resources.push({
        arn: queue.awsQueue.arn,
        access: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes"
        ]
    })

    const envVars = { ...(context.environmentVariables || {}), ...(queueHandler.environmentVariables || {}) }

    const callback = createLambda<QueueHandlerEvent, void>(
        queueHandler.name,
        environment,
        queueHandler.callback,
        queueHandler.policyStatements ?? [],
        envVars,
        queueHandler.resources,
        undefined,
        mergeOptions(queueHandler.lambdaOptions, context.api?.lambdaOptions)
    )

    if (queue.awsQueue)
        return queue.awsQueue.onEvent(`${topicName}_${queueHandler.name}_${environment}`, callback, {
            batchSize: queueHandler.subscriptionArgs?.batchSize,
            maximumBatchingWindowInSeconds: queueHandler.subscriptionArgs?.maximumBatchingWindowInSeconds
        })
    else
        throw `Cannot subscribe to this queue: ${queue.definition.name}`
}