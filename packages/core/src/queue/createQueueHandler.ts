import * as aws from "@pulumi/aws";
import { QueueResultItem } from "."
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from ".."
import { createLambda, LambdaFolder, LambdaOptions, LambdaResource } from '../lambdas'

import { Callback } from '@pulumi/aws/lambda';
import { QueueEvent, QueueEventSubscription, QueueEventSubscriptionArgs } from "@pulumi/aws/sqs";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";

export type QueueHandlerEvent = QueueEvent
export type QueueHandlerCallback = Callback<QueueHandlerEvent, void>

export type LambdaQueueHandler<TNames extends LambadaGrantsShape = LambadaGrantsShape> = {
    name: string
    queue: ResourceRef<QueueResultItem>
    /** A `FolderLambda` deploys a pre-built bundle instead of a serialized closure. */
    callback: QueueHandlerCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables,
    resources: LambadaResourceRequest<TNames>
    lambdaOptions?: LambdaOptions,
    subscriptionArgs?: QueueEventSubscriptionArgs | undefined
}


export const createQueueHandler = (
    context: LambadaResources,
    queueHandler: LambdaQueueHandler<any>,
): QueueEventSubscription => {
    const environment = context.environment
    const queue = resolveRef(context.queues, { name: queueHandler.name, kind: 'queue', ref: queueHandler.queue })
    const topicName = queue.definition.name

    const grants = resolveGrants(context, { name: queueHandler.name, resources: queueHandler.resources })

    if (context.kmsKeys && context.kmsKeys.dynamodb) {
        grants.push(
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

    grants.push({
        arn: queue.awsQueue.arn,
        access: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes"
        ]
    })

    const envVars = resolveEnvironment(context, {
        name: queueHandler.name,
        resources: queueHandler.resources,
        environmentVariables: queueHandler.environmentVariables,
    })

    const callback = createLambda<QueueHandlerEvent, void>(
        queueHandler.name,
        environment,
        queueHandler.callback,
        queueHandler.policyStatements ?? [],
        envVars,
        grants,
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