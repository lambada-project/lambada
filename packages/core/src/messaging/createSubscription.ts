import * as aws from "@pulumi/aws";
import { createLambda, LambdaOptions, LambdaResource } from '../lambdas'
import { MessagingContext, MessagingResultItem } from ".";
import { Callback } from '@pulumi/aws/lambda';
import { TopicEvent, TopicEventHandler,  } from "@pulumi/aws/sns";
import * as sns from "@pulumi/aws/sns";
import { String } from "aws-sdk/clients/cloudsearch";
import { LambadaResources, EmbroideryEnvironmentVariables } from "..";

export type TopicEventSubscriptionArgs = sns.TopicEventSubscriptionArgs & { customConfig: Omit<sns.TopicSubscriptionArgs, 
|'topic'
|'protocol'
|'endpoint'>}

export type SubscriptionEvent = TopicEvent
export type SubscriptionCallback = Callback<SubscriptionEvent, void>

export type LambdaSubscription = {
    name: string
    callback: SubscriptionCallback
    policyStatements: aws.iam.PolicyStatement[]
    environmentVariables: EmbroideryEnvironmentVariables,
    resources: LambdaResource[]
    subscriptionArgs?: TopicEventSubscriptionArgs
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

// --------------------------------- copied from @pulumi/aws/sns/snsMixins.d.ts:
import * as  lambda from "@pulumi/aws/sns/../lambda"
import * as  topic from "@pulumi/aws/sns/./topic"
import * as  topicSubscription from "@pulumi/aws/sns/./topicSubscription"
import * as  utils from "@pulumi/aws/sns/../utils"
import { ComponentResourceOptions } from "@pulumi/pulumi";

function withAliases(opts: any, aliases:any) {
    const allAliases = [];
    if (opts.aliases) {
        for (const alias of opts.aliases) {
            allAliases.push(alias);
        }
    }
    for (const alias of aliases) {
        allAliases.push(alias);
    }
    return Object.assign(Object.assign({}, opts), { aliases });
}
function withAlias(opts: any, alias: any) {
    return withAliases(opts, [alias]);
}
class TopicEventSubscription extends lambda.EventSubscription implements sns.TopicEventSubscription {
    public readonly topic: topic.Topic;
    public readonly subscription: topicSubscription.TopicSubscription;
    constructor(name: string, topic: topic.Topic, handler: TopicEventHandler, args?: TopicEventSubscriptionArgs, opts?: ComponentResourceOptions) {
        // We previously did not parent the subscription to the topic. We now do. Provide an alias
        // so this doesn't cause resources to be destroyed/recreated for existing stacks.
        super("aws:sns:TopicEventSubscription", name, Object.assign({ parent: topic }, withAlias(opts, { parent: opts?.parent })));
        this.topic = topic;
        const parentOpts = { parent: this };
        this.func = lambda.createFunctionFromEventHandler(name, handler, parentOpts);
        this.permission = new lambda.Permission(name, {
            action: "lambda:invokeFunction",
            function: this.func,
            principal: "sns.amazonaws.com",
            sourceArn: topic.id,
        }, parentOpts);
        this.subscription = new topicSubscription.TopicSubscription(name, {
            ...args?.customConfig, // this is the only change from the original, to allow custom configuration
            topic: topic,
            protocol: "lambda",
            endpoint: this.func.arn,
        }, parentOpts);
        this.registerOutputs();
    }
}
//--------------------------------- end of copy

export const subscribeToTopic = (
    context: LambadaResources,
    topic: MessagingResultItem,
    subscription: LambdaSubscription,
    options?: LambdaOptions,
): TopicEventSubscription => {
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

    const envVars = { ...(context.environmentVariables || {}), ...(subscription.environmentVariables || {}) }

    const callback = createLambda<TopicEvent, void>(
        subscription.name,
        environment,
        subscription.callback,
        subscription.policyStatements,
        envVars,
        subscription.resources,
        undefined,
        options
    )
    if (topic.awsTopic){
        return new TopicEventSubscription(`${topicName}_${subscription.name}_${environment}`, topic.awsTopic, callback, subscription.subscriptionArgs)
    }
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