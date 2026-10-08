import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { QueueResultItem } from "."
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from ".."
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas'

import { QueueEvent, QueueEventSubscription, QueueEventSubscriptionArgs } from "@pulumi/aws/sqs";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { BodyPolicy, Conditions, requireFilter } from "../filters";
import { hasShape, isRecord, isSomeOf, Shape, SomeOf } from "../types/forms";
import { isArray, Several } from "../types/lists";

export type QueueHandlerEvent = QueueEvent
export type QueueBatchResponse = { batchItemFailures: { itemIdentifier: string }[] }
export type QueueHandlerCallback = LambdaHandler<QueueHandlerEvent, void | QueueBatchResponse>

type QueueBody = BodyPolicy | Conditions<string>
type StringValue = { stringValue: Conditions<string> }
type QueuePattern = { body: QueueBody, messageAttributes: Record<string, StringValue>, $or: Several<QueueHandlerFilter> }
/** Lambda's filter pattern for an SQS record, written as declared. A body that is not JSON is matched as one string. */
export type QueueHandlerFilter = SomeOf<QueuePattern>

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

const STRING_VALUE: Shape<StringValue> = { stringValue: 'required' }

const requirePattern = (name: string, filter: QueueHandlerFilter): void => {
    if (!isSomeOf<QueuePattern>(filter, { body: true, messageAttributes: true, $or: true }) || ('$or' in filter && !(isArray(filter.$or) && filter.$or.length >= 2)))
        throw new Error(`${name} filters by ${JSON.stringify(filter)}; a pattern takes a body, messageAttributes or $or of two patterns or more`)
    if ('body' in filter) {
        const body = filter.body
        if (isRecord(body)) requireFilter.sqsBody(name, body)
        else requireFilter.sqsStrings(name, { body })
    }
    if ('messageAttributes' in filter) {
        const messageAttributes = filter.messageAttributes
        if (!isRecord(messageAttributes))
            throw new Error(`${name} filters messageAttributes by ${JSON.stringify(messageAttributes)}; messageAttributes holds each attribute's stringValue`)
        const values = Object.entries(messageAttributes).map(([attribute, held]) => hasShape(held, STRING_VALUE) ? [attribute, held.stringValue] : [attribute, undefined])
        const unheld = values.find(([, conditions]) => conditions === undefined)
        if (unheld) throw new Error(`${name} filters messageAttributes.${unheld[0]} by ${JSON.stringify(messageAttributes[unheld[0] as string])}; an attribute is matched by its stringValue`)
        requireFilter.sqsStrings(name, Object.fromEntries(values))
    }
    filter.$or?.forEach(branch => requirePattern(name, branch))
}

/** The longest pattern Lambda takes, as it answered: half what its documentation says. */
const LONGEST_PATTERN = 2048

const written = (name: string, filter: QueueHandlerFilter) => {
    requirePattern(name, filter)
    const pattern = JSON.stringify(filter)
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