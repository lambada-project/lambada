import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { QueueResultItem } from "."
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from ".."
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas'

import { QueueEvent, QueueEventSubscription, QueueEventSubscriptionArgs } from "@pulumi/aws/sqs";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { BodyPolicy, Conditions, requireFilter, StringAttributePolicy } from "../filters";

export type QueueHandlerEvent = QueueEvent
export type QueueBatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
export type QueueHandlerCallback = LambdaHandler<QueueHandlerEvent, void | QueueBatchResponse>

type QueueBody = BodyPolicy | Conditions<string>
type QueueFilterParts = { body: QueueBody, attributes: StringAttributePolicy, anyOf: readonly [QueueHandlerFilter, QueueHandlerFilter, ...QueueHandlerFilter[]] }
/**
 * A body that is not JSON is matched by conditions on the whole string. Every part given must
 * match; `anyOf` takes two filters or more, and matches when one or more of them do.
 */
export type QueueHandlerFilter = { [K in keyof QueueFilterParts]: Pick<QueueFilterParts, K> & Partial<Omit<QueueFilterParts, K>> }[keyof QueueFilterParts]

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

const isPlain = (body: QueueBody): body is Conditions<string> => Array.isArray(body)

const filterPattern = (name: string, filter: QueueHandlerFilter): object => {
    const { body, attributes, anyOf } = filter
    if (body && isPlain(body)) requireFilter.sqsStrings(name, { body })
    else if (body) requireFilter.sqsBody(name, body)
    if (attributes) requireFilter.sqsStrings(name, attributes)
    if ((anyOf && !(anyOf.length >= 2)) || (!body && !attributes && !anyOf))
        throw new Error(`${name} filters by ${JSON.stringify(filter)}; a filter takes a body, attributes or anyOf two filters or more`)
    return {
        ...(body && { body }),
        ...(attributes && { messageAttributes: Object.fromEntries(Object.entries(attributes).map(([attribute, conditions]) => [attribute, { stringValue: conditions }])) }),
        ...(anyOf && { $or: anyOf.map(branch => filterPattern(name, branch)) }),
    }
}

/** The longest pattern Lambda takes, as it answered: half what its documentation says. */
const LONGEST_PATTERN = 2048

const written = (name: string, filter: QueueHandlerFilter) => {
    const pattern = JSON.stringify(filterPattern(name, filter))
    if (pattern.length > LONGEST_PATTERN) throw new Error(`${name} filters by a pattern of ${pattern.length} characters, past the ${LONGEST_PATTERN} Lambda takes`)
    return pattern
}

export const eventSourceMappingArgs = ({ name, filter, reportBatchItemFailures, maximumConcurrency }: LambdaQueueHandler<any>) => ({
    ...(filter && { filterCriteria: { filters: [{ pattern: written(name, filter) }] } }),
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

    const callback = createLambda<QueueHandlerEvent, void | QueueBatchResponse>({
        name: queueHandler.name,
        environment,
        definition: artifact ?? queueHandler.callback,
        policyStatements: queueHandler.policyStatements,
        environmentVariables: envVars,
        resources: grants,
        options: mergeOptions(queueHandler.lambdaOptions, context.api?.lambdaOptions),
        logs: context.logs,
    })

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