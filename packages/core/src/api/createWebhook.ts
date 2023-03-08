import { LambadaResources, SubscriptionEvent } from "..";
import { Request, Response, Route } from '@pulumi/awsx/apigateway/api'
import { createEndpoint, EmbroideryEventHandlerRoute, LambadaEndpointArgs } from "./createEndpoint";
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { createLambda, LambdaResource } from "../lambdas";
import { createCallback } from "./callbackWrapper";
import { QueueArgs } from "@pulumi/aws/sqs";
import * as AWS from 'aws-sdk'
import { QueueHandlerEvent } from "../queue/createQueueHandler";

export function createWebhook(
    endpointParams: LambadaEndpointArgs,
    queueParams: QueueArgs,
    context: LambadaResources
): EmbroideryEventHandlerRoute {
    if (!endpointParams.name) throw new Error("Webhook name is empty");
    const queueName = `${endpointParams.name}-${context.environment}`
    const ENV_NAME = "WEBHOOK_QUEUE_URL"

    //Handler and queue must have the same
    const timeout = queueParams.visibilityTimeoutSeconds ?? endpointParams.options?.timeout ?? 30

    /****** QUEUE***** */


    const queue = new aws.sqs.Queue(queueName, {
        fifoQueue: true,
        name: queueName + '.fifo',//suffix is mandatory at the aws resource level
        contentBasedDeduplication: true,
        delaySeconds: queueParams.delaySeconds,
        receiveWaitTimeSeconds: queueParams.receiveWaitTimeSeconds,
        visibilityTimeoutSeconds: timeout
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
    const handlerCallback = createCallback({ // Change response back to Generic, cos this returns a Record[ ]
        callbackDefinition: async (e) => {
            const actualE = e as unknown as QueueHandlerEvent

            return Promise.all(actualE.Records.map(x => {
                const request = JSON.parse(x.body)
                return endpointParams.callbackDefinition(request)
            }))

        }, context
    })

    const queueHandler = createLambda<any, any>(
        endpointParams.name + '-handler',
        context.environment,
        handlerCallback,
        [],
        handlerEnvVars,
        handlerResources,
        undefined,
        { ...endpointParams.options, timeout: timeout }
    )

    queue.onEvent(queueName, queueHandler)




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
            await sqs.sendMessage({
                MessageBody: JSON.stringify(e),
                QueueUrl: process.env[ENV_NAME] || '',
                MessageGroupId: 'WEBHOOK_ITEM'
            }).promise()
            console.log('Message relayed to Queue')

            return {
                statusCode: 200
            }

        }, context
    })


    const envVars: { [key: string]: pulumi.Input<string> } = {}
    envVars[ENV_NAME] = queue.url

    const webhookHandler = createEndpoint<Request, Response>(
        endpointParams.name + '-webhook', context,
        endpointParams.path, endpointParams.method, cb, [],
        envVars,
        endpointParams.auth?.useCognitoAuthorizer,
        webhookResources, endpointParams.auth?.useApiKey,
        undefined,
        { ...endpointParams.options, timeout: timeout }
    )


    return webhookHandler
}