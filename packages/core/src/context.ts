import { CognitoAuthorizer, LambdaAuthorizer } from "@pulumi/awsx/classic/apigateway";
import { DatabaseResult } from "./database";
import { SecretsResult, SecurityResult } from "./security";
import { MessagingResult } from "./messaging";
import { NotificationResult } from "./notifications";
import { EmbroideryEnvironmentVariables } from ".";
import { QueuesResult } from "./queue";
import { FunctionVpcConfig, LambdaOptions } from "./lambdas";
import { Input } from '@pulumi/pulumi'

export type LambadaResources = {
    projectName: string
    api?: {
        apiPath: string,
        auth?: {
            useAuthorizers?: boolean,
            useApiKey?: boolean
        },
        cors?: {
            origins: string[]
            headers: string[]
        }
        vpcConfig?: Input<FunctionVpcConfig>
        lambdaOptions?: LambdaOptions
    },
    authorizers: (CognitoAuthorizer | LambdaAuthorizer)[]
    messaging?: MessagingResult
    queues?: QueuesResult
    notifications?: NotificationResult
    databases?: DatabaseResult
    environment: string
    kmsKeys?: SecurityResult
    environmentVariables: EmbroideryEnvironmentVariables
    secrets?: SecretsResult
    globalTags?: Input<{ [key: string]: Input<string> }>
}