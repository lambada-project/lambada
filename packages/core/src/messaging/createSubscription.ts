import * as aws from "@pulumi/aws";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas'
import { MessagingContext, MessagingResultItem } from ".";
import { TopicEvent, TopicEventSubscription, TopicEventSubscriptionArgs } from "@pulumi/aws/sns";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";

export type SubscriptionEvent = TopicEvent
export type SubscriptionCallback = LambdaHandler<SubscriptionEvent, void>

type SnsFilterCondition =
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
    | { cidr: string }

/** An SNS filter policy: each key lists the conditions any one of which matches its value. */
export type SnsFilterPolicy = { $or?: SnsFilterPolicy[] } & { [key: string]: SnsFilterCondition[] | SnsFilterPolicy | SnsFilterPolicy[] | undefined }

/** Which part of a message SNS matches the policy against: its message attributes, or its JSON body. */
export type SnsSubscriptionFilter = { attributes: SnsFilterPolicy } | { body: SnsFilterPolicy }

export const filterArgs = (subscriptionName: string, filter: SnsSubscriptionFilter | undefined, args: TopicEventSubscriptionArgs = {}): TopicEventSubscriptionArgs => {
    if (!filter) return args
    if (args.filterPolicy !== undefined || args.filterPolicyScope !== undefined) {
        throw new Error(`${subscriptionName} sets both filter and subscriptionArgs.filterPolicy`)
    }
    return 'attributes' in filter
        ? { ...args, filterPolicy: JSON.stringify(filter.attributes), filterPolicyScope: 'MessageAttributes' }
        : { ...args, filterPolicy: JSON.stringify(filter.body), filterPolicyScope: 'MessageBody' }
}

export type LambdaSubscription<TNames extends LambadaGrantsShape = LambadaGrantsShape> = {
    name: string
    /** A `FolderLambda` deploys a pre-built bundle instead of a serialized closure. */
    callback: SubscriptionCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables
    resources: LambadaResourceRequest<TNames>
    subscriptionArgs?: TopicEventSubscriptionArgs
    filter?: SnsSubscriptionFilter
}

export type LambadaSubscriptionHandler<TNames extends LambadaGrantsShape = LambadaGrantsShape> =
    LambdaSubscription<TNames> & { topic: ResourceRef<MessagingResultItem> }

export type LambdaSubscriptionSimple = {
    name: string
    callback: SubscriptionCallback | LambdaFolder
    resources: LambadaResourceRequest
}

// const context: MessagingContext = {
//     environment,
//     databases,
//     kmsKeys
// }

/** A subscription that carries its own topic name or item. */
export const createSubscription = (
    context: LambadaResources,
    subscription: LambadaSubscriptionHandler<any>,
    options?: LambdaOptions,
    overrideRole?: aws.iam.Role
): TopicEventSubscription => subscribeToTopic(context, subscription.topic, subscription, options, overrideRole)

export const subscribeToTopic = (
    context: LambadaResources,
    topicRef: ResourceRef<MessagingResultItem>,
    subscription: LambdaSubscription<any>,
    options?: LambdaOptions,
    overrideRole?: aws.iam.Role
): TopicEventSubscription => {
    const environment = context.environment
    const topic = resolveRef(context.messaging, { name: subscription.name, kind: 'topic', ref: topicRef })
    const topicName = topic.definition.name
    // policyStatements.push({
    //     Action: [
    //         "cognito-idp:AdminGetUser",
    //         "cognito-idp:ListUsers"
    //     ],
    //     Resource: apiContext.cognitoUserPool.arn,
    //     Effect: "Allow"
    // })
    const grants = resolveGrants(context, { name: subscription.name, resources: subscription.resources })

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

    const envVars = resolveEnvironment(context, {
        name: subscription.name,
        resources: subscription.resources,
        environmentVariables: subscription.environmentVariables,
    })

    const artifact = isLambdaFolder(subscription.callback)
        ? subscription.callback
        : bundleOf(context.bundles, subscription.name)

    const callback = createLambda<TopicEvent, void>(
        subscription.name,
        environment,
        artifact ?? subscription.callback,
        subscription.policyStatements ?? [],
        envVars,
        grants,
        overrideRole,
        mergeOptions(options, context.api?.lambdaOptions),
        `Handler for ${topic.definition.name} in ${environment} with subscription ${subscription.name}`,
        context.globalTags

    )
    if (topic.awsTopic)
        return topic.awsTopic.onEvent(`${topicName}_${subscription.name}_${environment}`, callback,
            filterArgs(subscription.name, subscription.filter, subscription.subscriptionArgs))
    else
        throw `Cannot subscribe to this topic: ${topic.definition.name}`
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