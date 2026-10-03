import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { QueueResultItem } from "."
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from ".."
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas'

import { QueueEvent, QueueEventSubscription, QueueEventSubscriptionArgs } from "@pulumi/aws/sqs";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";

export type QueueHandlerEvent = QueueEvent
export type QueueBatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
export type QueueHandlerCallback = LambdaHandler<QueueHandlerEvent, void | QueueBatchResponse>

type EventCondition =
    | string
    | number
    | boolean
    | null
    | { prefix: string }
    | { suffix: string }
    | { 'equals-ignore-case': string }
    | { 'anything-but': string | number | (string | number)[] | { prefix: string } | { suffix: string } }
    | { numeric: (string | number)[] }
    | { exists: boolean }

export type QueueEventPattern = { $or?: QueueEventPattern[] } & { [key: string]: EventCondition[] | QueueEventPattern | QueueEventPattern[] | undefined }

type AttributeCondition =
    | string
    | { prefix: string }
    | { suffix: string }
    | { 'equals-ignore-case': string }
    | { 'anything-but': string | string[] | { prefix: string } | { suffix: string } }
    | { exists: boolean }

export type QueueHandlerFilter = { body: QueueEventPattern } | { attributes: { [name: string]: AttributeCondition[] } }

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
    filter?: QueueHandlerFilter
    reportBatchItemFailures?: boolean
    maximumConcurrency?: number
}

const filterPattern = (filter: QueueHandlerFilter) => 'body' in filter
    ? { body: filter.body }
    : { messageAttributes: Object.fromEntries(Object.entries(filter.attributes).map(([name, conditions]) => [name, { stringValue: conditions }])) }

export const eventSourceMappingArgs = ({ filter, reportBatchItemFailures, maximumConcurrency }: LambdaQueueHandler<any>) => ({
    ...(filter && { filterCriteria: { filters: [{ pattern: JSON.stringify(filterPattern(filter)) }] } }),
    ...(reportBatchItemFailures && { functionResponseTypes: ['ReportBatchItemFailures'] }),
    ...(maximumConcurrency !== undefined && { scalingConfig: { maximumConcurrency } }),
})

export const withMappingArgs = (args: object): pulumi.ResourceTransform => ({ type, props, opts }) =>
    type === 'aws:lambda/eventSourceMapping:EventSourceMapping' ? { props: { ...props, ...args }, opts } : undefined


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

    const artifact = isLambdaFolder(queueHandler.callback)
        ? queueHandler.callback
        : bundleOf(context.bundles, queueHandler.name)

    const callback = createLambda<QueueHandlerEvent, void | QueueBatchResponse>(
        queueHandler.name,
        environment,
        artifact ?? queueHandler.callback,
        queueHandler.policyStatements ?? [],
        envVars,
        grants,
        undefined,
        mergeOptions(queueHandler.lambdaOptions, context.api?.lambdaOptions)
    )

    if (queue.awsQueue)
    {
        const mappingArgs = eventSourceMappingArgs(queueHandler)
        return queue.awsQueue.onEvent(`${topicName}_${queueHandler.name}_${environment}`, callback as aws.sqs.QueueEventHandler, {
            batchSize: queueHandler.subscriptionArgs?.batchSize,
            maximumBatchingWindowInSeconds: queueHandler.subscriptionArgs?.maximumBatchingWindowInSeconds
        }, Object.keys(mappingArgs).length ? { transforms: [withMappingArgs(mappingArgs)] } : undefined)
    }
    else
        throw `Cannot subscribe to this queue: ${queue.definition.name}`
}