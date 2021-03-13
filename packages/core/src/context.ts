import { CognitoAuthorizer, LambdaAuthorizer } from "@pulumi/awsx/apigateway";
import { DatabaseResult } from "./database";
import { SecretsResult, SecurityResult } from "./security";
import * as aws from '@pulumi/aws'
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
    },
    authorizers: CognitoAuthorizer[]
    messaging?: MessagingResult
    notifications?: NotificationResult
    databases?: DatabaseResult
    environment: string
    kmsKeys?: SecurityResult
    environmentVariables: EmbroideryEnvironmentVariables
    secrets?: SecretsResult
}