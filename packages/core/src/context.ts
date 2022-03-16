import { CognitoAuthorizer, LambdaAuthorizer } from "@pulumi/awsx/apigateway";
import { DatabaseResult } from "./database";
import { SecretsResult, SecurityResult } from "./security";
import * as pulumi from '@pulumi/pulumi'
import { MessagingResult } from "./messaging";
import { NotificationResult } from "./notifications";
import { EmbroideryEnvironmentVariables } from ".";

export type LambadaResources = {
    projectName: string
    api?: {
        apiPath: string,
        auth?: {
            useCognitoAuthorizer?: boolean,
            useApiKey?: boolean
        },
        cors?: {
            origins: string[]
        }
    },
    authorizers: CognitoAuthorizer[]
    messaging?: MessagingResult
    notifications?: NotificationResult
    databases?: DatabaseResult
    environment: string
    kmsKeys?: SecurityResult
    environmentVariables: EmbroideryEnvironmentVariables
    secrets?: SecretsResult
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
}