import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type RetentionDays = 1 | 3 | 5 | 7 | 14 | 30 | 60 | 90 | 120 | 150 | 180 | 365 | 400 | 545 | 731 | 1096 | 1827 | 2192 | 2557 | 2922 | 3288 | 3653

export type LogGroupDefinition = {
    name: string
    retention?: { days: RetentionDays }
}

export type LambadaLogGroups = { [id: string]: LogGroupDefinition }

export type LogGroupResultItem = {
    awsLogGroup: aws.cloudwatch.LogGroup
    definition: LogGroupDefinition
}

export type LogGroupsResult = { [id: string]: LogGroupResultItem }

export const createLogGroups = (
    environment: string,
    groups?: LambadaLogGroups,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
): LogGroupsResult =>
    Object.fromEntries(Object.entries(groups ?? {}).map(([key, definition]) => [key, {
        definition,
        awsLogGroup: new aws.cloudwatch.LogGroup(`${definition.name}-${environment}`, {
            name: `/lambada/${definition.name}-${environment}`,
            retentionInDays: definition.retention?.days,
            tags,
        }),
    }]))
