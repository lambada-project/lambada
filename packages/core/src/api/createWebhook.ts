import { LambadaResources, SubscriptionEvent } from "..";
import { Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import { createEndpoint, EmbroideryEventHandlerRoute, EmbroideryRequest, LambadaEndpointArgs } from "./createEndpoint";
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaResource } from "../lambdas";
import { createCallback } from "./callbackWrapper";
import { QueueArgs } from "@pulumi/aws/sqs";
import * as AWS from 'aws-sdk'
import { QueueHandlerEvent } from "../queue/createQueueHandler";
import { getBody } from "@lambada/utils";


export type LambadaWebhookCallback = (event: EmbroideryRequest, queueRecord: aws.sqs.QueueRecord) => Promise<object>

export function createWebhook(
    endpointParams: (LambadaEndpointArgs & {
        callbackDefinition: LambadaWebhookCallback,
    } ),
    context: LambadaResources
): EmbroideryEventHandlerRoute {
    if (!endpointParams.name) throw new Error("Webhook name is empty");
    const queueName = `${endpointParams.name}-${context.environment}`
    const ENV_NAME = "WEBHOOK_QUEUE_URL"

    const queueOptions = endpointParams.webhook?.options ?? {}
    const endpointOptions = endpointParams.options ?? {}

    endpointOptions.timeout = endpointOptions.timeout ?? 30
    queueOptions.visibilityTimeoutSeconds = queueOptions.visibilityTimeoutSeconds ?? 30

    if (queueOptions.visibilityTimeoutSeconds < endpointOptions.timeout) {
        throw new Error("Queue visibilityTimeoutSeconds must be greater or equal than the endpoint's timeout")
    }

    /****** QUEUE***** */

    const queue = new aws.sqs.Queue(queueName, {
        ...queueOptions,

        fifoThroughputLimit: queueOptions.fifoThroughputLimit ?? 'perMessageGroupId',
        deduplicationScope: queueOptions.deduplicationScope ?? 'messageGroup',

        fifoQueue: true,
        name: queueName + '.fifo',//suffix is mandatory at the aws resource level
        contentBasedDeduplication: true,
    })


    const handlerResources: LambdaResource[] = endpointParams.resources ?? []
    if (context.kmsKeys && context.kmsKeys.dynamodb) {
        handlerResources.push(
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

    const handlerEnvVars = { ...(context.environmentVariables || {}), ...(endpointParams.environmentVariables || {}) }
    const handlerCallback = async (e: QueueHandlerEvent) => {
        return Promise.all(e.Records.map(x => {
            const request = JSON.parse(x.body)
            return endpointParams.callbackDefinition(request, x)
        }))
    }


    const queueHandler = createLambda<any, any>(
        endpointParams.name + '-handler',
        context.environment,
        handlerCallback,
        [],
        handlerEnvVars,
        handlerResources,
        undefined,
        { ...endpointParams.options, timeout: endpointOptions.timeout }
    )

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
            const sqs = new AWS.SQS()

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
            }).promise()
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
        undefined,
        { ...endpointParams.options, timeout: endpointOptions.timeout }
    )


    return webhookHandler
}