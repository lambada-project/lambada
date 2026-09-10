import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { BucketArgs } from '@pulumi/aws/s3'

type BucketParams = Omit<BucketArgs, "bucket" | "tags">

/** An S3 name is global to every AWS account and the convention adds only the environment. */
export type BucketDefinition = {
    /** What the bucket is called, as `${name}-${environment}`. Renaming one replaces it. */
    name: string
    /** Published to every function granted this bucket, carrying the bucket name. */
    envKeyName: string
    options?: BucketParams
}

/** A bucket that already exists, addressed by name: an S3 bucket's id is its name. */
export type BucketReferenceDefinition = {
    id: pulumi.Input<string>
    envKeyName: string
}

export type LambadaBuckets = { [id: string]: BucketDefinition }

export type LambadaBucketsRef = {
    /** A definition's `name` is the full physical name here, project prefix and all. */
    [id: string]: BucketDefinition | BucketReferenceDefinition
}

export type BucketResultItem = {
    awsS3Bucket: aws.s3.Bucket
    envKeyName: string
    definition: BucketDefinition | BucketReferenceDefinition
}

export type BucketsResult = { [id: string]: BucketResultItem }

export const bucketName = (name: string, environment: string) => `${name}-${environment}`

const isReferenceDefinition = (
    item: BucketDefinition | BucketReferenceDefinition
): item is BucketReferenceDefinition => 'id' in item

const isResultItem = (
    item: BucketResultItem | BucketDefinition | BucketReferenceDefinition
): item is BucketResultItem => 'awsS3Bucket' in item

export function createBucket(
    definition: BucketDefinition,
    environment: string,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
): BucketResultItem {
    const bucket = bucketName(definition.name, environment)

    return {
        awsS3Bucket: new aws.s3.Bucket(bucket, {
            ...(definition.options ?? {}),
            bucket,
            tags
        }),
        envKeyName: definition.envKeyName,
        definition
    }
}

function findBucket(name: string, environment: string): aws.s3.Bucket {
    const bucket = bucketName(name, environment)
    const found = pulumi.output(aws.s3.getBucket({ bucket }, { async: true }))

    return aws.s3.Bucket.get(bucket, found.id)
}

export const createBuckets = (
    environment: string,
    buckets?: LambadaBuckets,
    bucketsRef?: LambadaBucketsRef | BucketsResult,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
): BucketsResult => {
    const result: BucketsResult = {}

    for (const key in buckets) {
        if (Object.prototype.hasOwnProperty.call(buckets, key)) {
            const definition = buckets[key]
            result[key] = createBucket(definition, environment, tags)
        }
    }

    for (const key in bucketsRef) {
        if (Object.prototype.hasOwnProperty.call(bucketsRef, key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref bucket with the same name of an existing bucket: ${key}`)
            }
            const bucket = bucketsRef[key]

            if (isResultItem(bucket)) {
                result[key] = bucket
            } else {
                result[key] = {
                    awsS3Bucket: isReferenceDefinition(bucket)
                        ? aws.s3.Bucket.get(`${key}-${environment}`, bucket.id)
                        : findBucket(bucket.name, environment),
                    envKeyName: bucket.envKeyName,
                    definition: bucket
                }
            }
        }
    }

    return result
}
