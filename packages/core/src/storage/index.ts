import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { BucketArgs } from '@pulumi/aws/s3'

type StorageParams = Omit<BucketArgs, "tags" | 'description'>


export function CreateBucket(item: BucketDefinition, name: string, environment: string, args: StorageParams,tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>,): StorageResultItem {
    const bucketName = `${name}-${environment}`

    const bucket = new aws.s3.Bucket(bucketName, {
        // description: `KMS key: ${name} - Environment: ${environment} - Created by Embroidery`,
        tags,
        ...args
    })

    return {
        awsS3Bucket: bucket,
        ref: pulumi.output({
            id: bucket.id,
            arn: bucket.arn,
        }),
        definition: item
    }
}

function findBucket(name: string, environment: string): pulumi.Output<BucketReference> {
    const bucketName = `${name}-${environment}`
    return pulumi.output(aws.s3.getBucket({
        bucket: bucketName,
    }, { async: true }))
}

export type BucketDefinition = {
    name: string
    envKeyName: string
    options?: StorageParams
}

export type LambadaBuckets = {
    [id: string]: BucketDefinition
}


export function createStorageBuckets(projectName: string, environment: string, buckets: LambadaBuckets | undefined, bucketRef: LambadaBuckets | StorageResult | undefined, tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>,): StorageResult {
    const result: StorageResult = {}

    for (const bucket in buckets) {
        if (buckets.hasOwnProperty(bucket)) {
            const bucketItem = buckets[bucket]
            result[bucket] = CreateBucket(bucketItem, `${projectName}-${bucketItem.name}`, environment, bucketItem.options ?? {}, tags)
        }
    }

    for (const key in bucketRef) {
        if (bucketRef.hasOwnProperty(key)) {
            if (result[key]) {
                throw new Error(`Cannot create a ref key with the same name of an existing key: ${key}`)
            }
            const bucket = bucketRef[key]

            function isRef(obj: StorageResultItem | BucketDefinition): obj is StorageResultItem {
                return !!(obj as StorageResultItem).awsS3Bucket
            }

            if (isRef(bucket)) {
                result[key] = bucket
            } else {
                result[key] = {
                    ref: findBucket(bucket.name, environment),
                    definition: bucket,
                }
            }
        }
    }

    return result
}

type BucketReference = {
    id: string
    arn: string
}

export type StorageResultItem = {
    awsS3Bucket?: aws.s3.Bucket
    ref: pulumi.Output<BucketReference>
    definition: BucketDefinition
}

export type StorageResult = {
    [id: string]: StorageResultItem
}