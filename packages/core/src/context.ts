import { CognitoAuthorizer } from "@pulumi/awsx/classic/apigateway";
import { DatabaseResult } from "./database";
import { SecretsResult, SecurityResult } from "./security";
import { MessagingResult } from "./messaging";
import { NotificationResult } from "./notifications";
import { EmbroideryEnvironmentVariables } from ".";
import { QueuesResult } from "./queue";

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
    queues?: QueuesResult
    notifications?: NotificationResult
    databases?: DatabaseResult
    environment: string
    kmsKeys?: SecurityResult
    environmentVariables: EmbroideryEnvironmentVariables
    secrets?: SecretsResult
}