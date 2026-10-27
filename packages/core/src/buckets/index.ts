import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { BucketArgs } from '@pulumi/aws/s3'

type BucketParams = Omit<BucketArgs, "bucket" | "tags">

/**
 * Key spaces of a bucket, granted by name like the bucket itself: a grant of one reaches only the
 * objects whose keys start with its prefix. The keys share the namespace of the buckets.
 */
export type BucketPrefixes = { [key: string]: string }

/** A distribution lambada builds in front of the bucket, the only reader the bucket lets in from outside. */
export type BucketCdnDefinition = {
    /** The prefixes, by key, the distribution may read. Left out, every object. */
    prefixes?: string[]
    /** Published to every function granted the bucket or one of its prefixes, carrying the distribution's domain. */
    envKeyName?: string
    /** Merged over the distribution lambada writes. Its one origin is `bucket`. */
    options?: Partial<aws.cloudfront.DistributionArgs>
}

/** An S3 name is global to every AWS account and the convention adds only the environment. */
export type BucketDefinition = {
    /** What the bucket is called, as `${name}-${environment}`. Renaming one replaces it. */
    name: string
    /** Published to every function granted this bucket, carrying the bucket name. */
    envKeyName: string
    /** Blocks public access and denies requests that are not over TLS. On by default. */
    hardened?: boolean
    prefixes?: BucketPrefixes
    cdn?: BucketCdnDefinition
    options?: BucketParams
}

/** A bucket that already exists, addressed by name: an S3 bucket's id is its name. */
export type BucketReferenceDefinition = {
    id: pulumi.Input<string>
    envKeyName: string
    prefixes?: BucketPrefixes
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
    /** Set on a prefix's item: the start of every key a grant of it reaches. */
    prefix?: string
    cdn?: { distribution: aws.cloudfront.Distribution, envKeyName?: string }
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

    const awsS3Bucket = new aws.s3.Bucket(bucket, {
        ...(definition.options ?? {}),
        bucket,
        tags
    })

    const hardened = definition.hardened !== false
    if (hardened) blockPublicAccess(bucket, awsS3Bucket)

    const distribution = definition.cdn && createDistribution(bucket, awsS3Bucket, definition.cdn, tags)
    const statements = [
        ...(hardened ? [denyInsecureTransport] : []),
        ...(distribution ? [cdnReads(bucket, definition, distribution)] : []),
    ]
    if (statements.length) writePolicy(bucket, awsS3Bucket, definition, statements)

    return {
        awsS3Bucket,
        envKeyName: definition.envKeyName,
        definition,
        ...(distribution && { cdn: { distribution, envKeyName: definition.cdn!.envKeyName } }),
    }
}

const blockPublicAccess = (bucket: string, awsS3Bucket: aws.s3.Bucket) =>
    new aws.s3.BucketPublicAccessBlock(`${bucket}-public-access`, {
        bucket: awsS3Bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
    })

type BucketStatement = (arn: string) => pulumi.Input<object>

const denyInsecureTransport: BucketStatement = arn => ({
    Sid: 'DenyInsecureTransport',
    Effect: 'Deny',
    Principal: '*',
    Action: 's3:*',
    Resource: [arn, `${arn}/*`],
    Condition: {
        Bool: { 'aws:SecureTransport': 'false' }
    }
})

/** CloudFront signs as its service, so the bucket names the one distribution it serves. */
const cdnReads = (bucket: string, definition: BucketDefinition, distribution: aws.cloudfront.Distribution): BucketStatement => {
    // An empty list would read as "every object" below; an allowlist that emptied must serve nothing.
    if (definition.cdn?.prefixes?.length === 0) {
        throw new Error(`Cannot serve the bucket '${bucket}' through its cdn: cdn.prefixes is empty. Leave it out to serve every object, or leave out cdn.`)
    }
    const served = (definition.cdn?.prefixes ?? []).map(key => {
        const prefix = definition.prefixes?.[key]
        if (prefix === undefined) {
            const declared = Object.keys(definition.prefixes ?? {})
            throw new Error(
                `Cannot serve the bucket '${bucket}' through its cdn: it names the prefix '${key}', which the ` +
                `bucket does not declare. It declares: ${declared.length ? declared.join(', ') : 'none'}.`
            )
        }
        return prefix
    })
    return arn => distribution.arn.apply(source => ({
        Sid: 'CdnReadsObjects',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: 's3:GetObject',
        Resource: served.length ? served.map(prefix => `${arn}/${prefix}*`) : `${arn}/*`,
        Condition: { StringEquals: { 'AWS:SourceArn': source } },
    }))
}

const writePolicy = (bucket: string, awsS3Bucket: aws.s3.Bucket, definition: BucketDefinition, statements: BucketStatement[]) => {
    // A BucketPolicy owns the whole document, so it would silently replace one given through options.
    if (definition.options?.policy) {
        throw new Error(
            `Cannot write the policy of the bucket '${bucket}': it sets its own policy through options, ` +
            `which lambada's would replace. Leave out cdn and set hardened: false to keep it.`
        )
    }

    new aws.s3.BucketPolicy(`${bucket}-policy`, {
        bucket: awsS3Bucket.id,
        policy: awsS3Bucket.arn.apply(arn => pulumi.all(statements.map(statement => statement(arn))))
            .apply(Statement => JSON.stringify({ Version: '2012-10-17', Statement })),
    }, { aliases: [{ name: `${bucket}-tls-only` }] })
}

/** A cache policy AWS manages: GET and HEAD, compressed, cached a day by default. */
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6'

const createDistribution = (
    bucket: string,
    awsS3Bucket: aws.s3.Bucket,
    cdn: BucketCdnDefinition,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
) => {
    const originAccess = new aws.cloudfront.OriginAccessControl(`${bucket}-cdn`, {
        name: `${bucket}-cdn`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
    })

    return new aws.cloudfront.Distribution(`${bucket}-cdn`, {
        enabled: true,
        origins: [{ originId: 'bucket', domainName: awsS3Bucket.bucketRegionalDomainName, originAccessControlId: originAccess.id }],
        defaultCacheBehavior: {
            targetOriginId: 'bucket',
            viewerProtocolPolicy: 'redirect-to-https',
            allowedMethods: ['GET', 'HEAD'],
            cachedMethods: ['GET', 'HEAD'],
            cachePolicyId: CACHING_OPTIMIZED,
            compress: true,
        },
        restrictions: { geoRestriction: { restrictionType: 'none' } },
        viewerCertificate: { cloudfrontDefaultCertificate: true },
        tags,
        ...cdn.options,
    })
}

function findBucket(name: string, environment: string): aws.s3.Bucket {
    const bucket = bucketName(name, environment)
    const found = pulumi.output(aws.s3.getBucket({ bucket }, { async: true }))

    return aws.s3.Bucket.get(bucket, found.id)
}

/** What is wrong with a prefix: IAM would read a wildcard in it, and an S3 key never starts with '/'. */
const prefixProblem = (prefix: string) =>
    prefix === '' ? 'is empty: grant the bucket instead'
        : /[*?]/.test(prefix) ? 'holds a wildcard, which IAM would read as one'
            : prefix.startsWith('/') ? "starts with '/', which no S3 key does"
                : undefined

export const createBuckets = (
    environment: string,
    buckets?: LambadaBuckets,
    bucketsRef?: LambadaBucketsRef | BucketsResult,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
): BucketsResult => {
    const result: BucketsResult = {}

    const add = (key: string, item: BucketResultItem) => {
        if (result[key]) {
            throw new Error(`Cannot add the bucket or prefix '${key}': the stack already has a bucket or prefix by that name`)
        }
        result[key] = item
    }
    const addWithPrefixes = (key: string, item: BucketResultItem) => {
        add(key, item)
        for (const [prefixKey, prefix] of Object.entries(item.definition.prefixes ?? {})) {
            const problem = prefixProblem(prefix)
            if (problem) throw new Error(`Cannot declare the prefix '${prefixKey}' of the bucket '${key}': '${prefix}' ${problem}.`)
            add(prefixKey, { ...item, prefix })
        }
    }

    for (const key in buckets) {
        if (Object.prototype.hasOwnProperty.call(buckets, key)) {
            addWithPrefixes(key, createBucket(buckets[key], environment, tags))
        }
    }

    for (const key in bucketsRef) {
        if (Object.prototype.hasOwnProperty.call(bucketsRef, key)) {
            const bucket = bucketsRef[key]

            if (isResultItem(bucket)) {
                add(key, bucket)
            } else {
                if ('cdn' in bucket && bucket.cdn) {
                    throw new Error(`Cannot serve the referenced bucket '${key}' through a cdn: its policy belongs to the stack that owns it.`)
                }
                addWithPrefixes(key, {
                    awsS3Bucket: isReferenceDefinition(bucket)
                        ? aws.s3.Bucket.get(`${key}-${environment}`, bucket.id)
                        : findBucket(bucket.name, environment),
                    envKeyName: bucket.envKeyName,
                    definition: bucket
                })
            }
        }
    }

    return result
}
