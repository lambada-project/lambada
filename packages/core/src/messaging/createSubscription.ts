import * as aws from "@pulumi/aws";
import { createLambda, LambdaFolder, LambdaHandler, LambdaOptions, LambdaResource } from '../lambdas'
import { MessagingContext, MessagingResultItem } from ".";
import { TopicEvent, TopicEventSubscription, TopicEventSubscriptionArgs } from "@pulumi/aws/sns";
import { LambadaResources, EmbroideryEnvironmentVariables, mergeOptions } from "..";
import { LambadaResourceRequest, LambadaGrantsShape, ResourceRef, resolveEnvironment, resolveGrants, resolveRef } from "../resources/grants";
import { bundleOf, isLambdaFolder } from "../lambdas/bundles";
import { AsyncFailures, asyncInvocationConfig, failureDestination } from "../lambdas/asyncFailures";
import { AttributePolicy, BodyPolicy, requireFilter } from "../filters";
import { isOneOf, OneOf } from "../types/forms";

export type SubscriptionEvent = TopicEvent
export type SubscriptionCallback = LambdaHandler<SubscriptionEvent, void>

type Scopes = { attributes: AttributePolicy, body: BodyPolicy }
export type SnsSubscriptionFilter = OneOf<Scopes>

/** A subscription's policy is stated in its filter, which is checked; never as a raw string beside it. */
export type SubscriptionArgs = Omit<TopicEventSubscriptionArgs, 'filterPolicy' | 'filterPolicyScope'>

export const filterArgs = (subscriptionName: string, filter: SnsSubscriptionFilter | undefined, args: SubscriptionArgs = {}): TopicEventSubscriptionArgs => {
    const raw = ['filterPolicy', 'filterPolicyScope'].find(key => key in args)
    if (raw !== undefined) throw new Error(`${subscriptionName} sets subscriptionArgs.${raw}; a subscription is filtered by its filter`)
    if (filter === undefined) return args
    if (!isOneOf<Scopes>(filter, { attributes: true, body: true }))
        throw new Error(`${subscriptionName} filters by ${JSON.stringify(filter)}; a filter takes attributes or body, one of them`)
    if (filter.attributes !== undefined) {
        requireFilter.snsAttributes(subscriptionName, filter.attributes)
        return { ...args, filterPolicy: JSON.stringify(filter.attributes), filterPolicyScope: 'MessageAttributes' }
    }
    requireFilter.snsBody(subscriptionName, filter.body)
    return { ...args, filterPolicy: JSON.stringify(filter.body), filterPolicyScope: 'MessageBody' }
}

export type LambdaSubscription<TNames extends LambadaGrantsShape = LambadaGrantsShape> = AsyncFailures & {
    name: string
    /** A `FolderLambda` deploys a pre-built bundle instead of a serialized closure. */
    callback: SubscriptionCallback | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    environmentVariables?: EmbroideryEnvironmentVariables
    resources: LambadaResourceRequest<TNames>
    subscriptionArgs?: SubscriptionArgs
    lambdaOptions?: LambdaOptions
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
    const destination = failureDestination(context, subscription.name, subscription)
    if (destination) grants.push(destination.grant)


    const envVars = resolveEnvironment(context, {
        name: subscription.name,
        resources: subscription.resources,
        environmentVariables: subscription.environmentVariables,
    })

    const artifact = isLambdaFolder(subscription.callback)
        ? subscription.callback
        : bundleOf(context.bundles, subscription.name)

    const callback = createLambda<TopicEvent, void>({
        name: subscription.name,
        environment,
        definition: artifact ?? subscription.callback,
        policyStatements: subscription.policyStatements,
        environmentVariables: envVars,
        resources: grants,
        role: overrideRole,
        options: mergeOptions(mergeOptions(subscription.lambdaOptions, options), context.api?.lambdaOptions),
        description: `Handler for ${topic.definition.name} in ${environment} with subscription ${subscription.name}`,
        tags: context.globalTags,
        logs: context.logs,
    })
    asyncInvocationConfig(subscription.name, environment, (callback as aws.lambda.Function).name, subscription, destination?.arn)

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