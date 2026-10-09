import { LambadaResources } from "..";
import { Request, Response } from '@pulumi/awsx/classic/apigateway/api'
import { createEndpoint, EmbroideryEventHandlerRoute, EmbroideryRequest, LambadaEndpointArgs, mergeOptions } from "./createEndpoint";
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaOptions, LambdaResource } from "../lambdas";
import { QueueArgs } from "@pulumi/aws/sqs";
import { createCallback } from "./callbackWrapper";
import * as SQS from '@aws-sdk/client-sqs'
import { QueueHandlerEvent } from "../queue/createQueueHandler";
import { getBody } from "@lambada/utils";
import { resolveEnvironment, resolveGrants } from '../resources/grants';
import { lift2 } from '../inputs';


export type LambadaWebhookCallback = (event: EmbroideryRequest, queueRecord: aws.sqs.QueueRecord) => Promise<object>

/** What SQS gives a queue that sets none, and so what a webhook's handler is given by default. */
const SQS_DEFAULT_VISIBILITY = 30

/**
 * The queue's visibility timeout, refused when it is shorter than the handler it hides messages
 * from: a message that reappears before the handler finishes is processed twice.
 */
export const requireVisibilityCoversTimeout = (visibility = SQS_DEFAULT_VISIBILITY, handler = SQS_DEFAULT_VISIBILITY): number => {
    if (visibility < handler) {
        throw new Error(
            `Queue visibilityTimeoutSeconds (${visibility}) must be greater or equal than the ` +
            `endpoint's timeout (${handler}).`
        )
    }

    return visibility
}

/**
 * The same rule, applied where the values are known. Both may be Inputs, and comparing an Input as
 * a number is always false, so the check cannot be made here. The checked value is returned rather
 * than merely validated: an `apply` nothing consumes may never run, so the queue is built from this.
 */
export const visibilityTimeoutFor = (
    visibilityTimeoutSeconds: pulumi.Input<number | undefined>,
    timeout: pulumi.Input<number | undefined>
): pulumi.Output<number> =>
    lift2(visibilityTimeoutSeconds, timeout, requireVisibilityCoversTimeout)

/**
 * The webhook's function and queue options with their defaults, on copies: a caller sharing one
 * options object between endpoints must not find the webhook's timeout written into it.
 */
export const webhookOptions = (endpointParams: { lambdaOptions?: LambdaOptions, webhook?: { options?: QueueArgs } }) => {
    const endpointOptions: LambdaOptions = { ...endpointParams.lambdaOptions }
    endpointOptions.timeout = endpointOptions.timeout ?? SQS_DEFAULT_VISIBILITY
    const queueOptions: QueueArgs = {
        ...endpointParams.webhook?.options,
        visibilityTimeoutSeconds: visibilityTimeoutFor(endpointParams.webhook?.options?.visibilityTimeoutSeconds, endpointOptions.timeout),
    }
    return { queueOptions, endpointOptions }
}

export function createWebhook(
    endpointParams: (LambadaEndpointArgs<any, any> & {
        callbackDefinition: LambadaWebhookCallback,
    }),
    context: LambadaResources
): EmbroideryEventHandlerRoute {
    if (!endpointParams.name) throw new Error("Webhook name is empty");
    const queueName = `${endpointParams.name}-${context.environment}`
    const ENV_NAME = "WEBHOOK_QUEUE_URL"

    const { queueOptions, endpointOptions } = webhookOptions(endpointParams)

    /****** QUEUE***** */

    const queue = new aws.sqs.Queue(queueName, {
        ...queueOptions,

        fifoThroughputLimit: queueOptions.fifoThroughputLimit ?? 'perMessageGroupId',
        deduplicationScope: queueOptions.deduplicationScope ?? 'messageGroup',

        fifoQueue: true,
        name: queueName + '.fifo',//suffix is mandatory at the aws resource level
        contentBasedDeduplication: true,
    })


    const handlerResources: LambdaResource[] = resolveGrants(context, { name: endpointParams.name, resources: endpointParams.resources })

    handlerResources.push({
        // queue: {
        //     awsQueue: queue,
        //     envKeyName: ENV_NAME,
        //     ref: pulumi.Output.create({ arn: queue.arn, id: queue.id, name: queue.name, url: queue.url }),
        //     definition: { envKeyName: ENV_NAME, name: endpointParams.name, options: queueParams }
        // },
        arn: queue.arn,
        access: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes"
        ]
    })

    const handlerEnvVars = resolveEnvironment(context, {
        name: endpointParams.name,
        resources: endpointParams.resources,
        environmentVariables: endpointParams.environmentVariables,
    })
    const handlerCallback = async (e: QueueHandlerEvent) => {
        return Promise.all(e.Records.map(x => {
            const request = JSON.parse(x.body)
            return endpointParams.callbackDefinition(request, x)
        }))
    }


    const queueHandler = createLambda<any, any>({
        name: endpointParams.name + '-handler',
        environment: context.environment,
        definition: handlerCallback,
        environmentVariables: handlerEnvVars,
        resources: handlerResources,
        options: mergeOptions(endpointOptions, context.api?.lambdaOptions),
        logs: context.logs,
    })

    queue.onEvent(queueName, queueHandler, {
        batchSize: 1,
    })




    /****** WEBHOOK **********/


    const webhookResources: LambdaResource[] = [
        {
            // not sure why this is not working
            // queue: {
            //     awsQueue: queue,
            //     envKeyName: ENV_NAME,
            //     ref: pulumi.Output.create({ arn: queue.arn, id: queue.id, name: queue.name, url: queue.url }),
            //     definition: { envKeyName: ENV_NAME, name: endpointParams.name, options: queueParams }
            // },
            arn: queue.arn,
            access: [
                "sqs:SendMessage",
            ]
        }
    ]

    const cb = createCallback({
        callbackDefinition: async (e) => {
            const sqs = new SQS.SQS()

            let messageGroupId = 'WEBHOOK_ITEM'

            const groupField = process.env.MESSAGE_GROUP_ID_FIELD
            const groupSource = process.env.MESSAGE_GROUP_ID_SOURCE

            if (groupField && groupSource == 'body' && e.request.body) {
                const body = getBody<{ [key: string]: string }>(e.request)
                messageGroupId = body[groupField] || messageGroupId
            }

            await sqs.sendMessage({
                MessageBody: JSON.stringify(e),
                QueueUrl: process.env[ENV_NAME] || '',
                MessageGroupId: messageGroupId
            })
            console.log('Message relayed to Queue')

            return {
                statusCode: 200
            }

        }, context
    })


    const envVars: { [key: string]: pulumi.Input<string> } = {}
    envVars[ENV_NAME] = queue.url
    if (endpointParams.webhook?.messageGroupId?.field) {
        envVars['MESSAGE_GROUP_ID_FIELD'] = endpointParams.webhook?.messageGroupId.field
        envVars['MESSAGE_GROUP_ID_SOURCE'] = endpointParams.webhook?.messageGroupId.source
    }

    const webhookHandler = createEndpoint<Request, Response>(
        endpointParams.name + '-webhook', context,
        endpointParams.path, endpointParams.method, cb, [],
        envVars,
        endpointParams.auth?.useCognitoAuthorizer,
        webhookResources, endpointParams.auth?.useApiKey,
        endpointParams.auth?.lambdaAuthorizer,
        endpointOptions,
        endpointParams.auth?.authorizer
    )


    return webhookHandler
}