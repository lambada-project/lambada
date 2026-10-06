import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { LambadaResources } from "..";
import type { MessagingResultItem } from "../messaging";
import type { QueueResultItem } from "../queue";
import { resolveRef, ResourceRef } from "../resources/grants";
import type { LambdaResource } from ".";
import type { Digit, Numbers, Positive } from "../numbers";

type Minutes = Numbers<`${Positive}` | `${Positive}${Digit}` | `${1 | 2}${Digit}${Digit}` | `3${0 | 1 | 2 | 3 | 4 | 5}${Digit}` | '360'>
type Age = { minutes: Minutes, hours?: never } | { hours: 1 | 2 | 3 | 4 | 5 | 6, minutes?: never }

export type AsyncFailures = {
    onFailure?: { queue: ResourceRef<QueueResultItem>, topic?: never } | { topic: ResourceRef<MessagingResultItem>, queue?: never }
    retries?: 0 | 1 | 2
    maximumEventAge?: Age
}

const ageInSeconds = (name: string, age: Age) => {
    const [count, seconds] = age.minutes !== undefined ? [age.minutes, age.minutes * 60] : [age.hours, age.hours * 3600]
    if (!Number.isInteger(count) || seconds < 60 || seconds > 21600) {
        throw new Error(`${name} keeps events for ${seconds} seconds; Lambda keeps them between 1 minute and 6 hours, in whole minutes or hours`)
    }
    return seconds
}

export const failureDestination = (context: LambadaResources, name: string, failures: AsyncFailures) => {
    const { onFailure } = failures
    if (!onFailure) return undefined
    if ('queue' in onFailure && onFailure.queue !== undefined) {
        const arn = resolveRef(context.queues, { name, kind: 'queue', ref: onFailure.queue }).awsQueue.arn
        return { arn, grant: { arn, access: ['sqs:SendMessage'] } as LambdaResource }
    }
    const arn = resolveRef(context.messaging, { name, kind: 'topic', ref: onFailure.topic! }).ref.arn
    return { arn, grant: { arn, access: ['sns:Publish'] } as LambdaResource }
}

export const asyncInvocationConfig = (
    name: string,
    environment: string,
    functionName: pulumi.Input<string>,
    failures: AsyncFailures,
    destination: pulumi.Input<string> | undefined
) => {
    if (failures.retries === undefined && !failures.maximumEventAge && destination === undefined) return undefined

    return new aws.lambda.FunctionEventInvokeConfig(`${name}-${environment}`, {
        functionName,
        maximumRetryAttempts: failures.retries,
        maximumEventAgeInSeconds: failures.maximumEventAge && ageInSeconds(name, failures.maximumEventAge),
        destinationConfig: destination === undefined ? undefined : { onFailure: { destination } },
    })
}
