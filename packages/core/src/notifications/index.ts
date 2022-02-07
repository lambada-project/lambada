import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export type NotificationConfig = {
    GCMCredential?: string
}

export default function createNotification(projectName: string, env: string, config?: NotificationConfig): NotificationResult {
    // const config = new pulumi.Config('fcm');
    // const fcmPlatformCredential = config.requireSecret("platformCredential");

    const gcmApplication = config?.GCMCredential ? new aws.sns.PlatformApplication(`${projectName}-${env}`, {
        platform: "GCM", //FCM - GCM
        platformCredential: config?.GCMCredential // TODO Pass platform access key as parameter
    }) : undefined

    return {
        gcm: gcmApplication ? {
            application: gcmApplication
        } : undefined
    }
}

export type NotificationResultItem = {
    application: aws.sns.PlatformApplication
}

export type NotificationResult = {
    gcm?: NotificationResultItem
}