import * as AWS from "aws-sdk"
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";



export default function createNotification(projectName: string, env: string) : NotificationResult {
    const config = new pulumi.Config('fcm');
    const fcmPlatformCredential = config.requireSecret("platformCredential");

    const gcmApplication = new aws.sns.PlatformApplication(`${projectName}-${env}`, {
        platform: "GCM", //FCM - GCM
        platformCredential: "", // TODO Pass platform access key as parameter
    });

    return  {
        gcm: {
            application: gcmApplication
        }
    }
}

export type NotificationResultItem = {
    application: aws.sns.PlatformApplication
} 

export type NotificationResult = {
    gcm: NotificationResultItem
}