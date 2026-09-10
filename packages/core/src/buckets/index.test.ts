import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments } from '..'
import { createDiagnostics } from '../resources/diagnostics'
import { findMissingGrants, toLambdaResources } from '../resources/grants'
import { bucketName, BucketsResult, createBuckets } from '.'

const built: { name: string, type: string, id?: string, inputs: any }[] = []
const looked: string[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, id: args.id, inputs: args.inputs })
        // A bucket's id is its name: `args.id` on a `.get`, the `bucket` input on a create.
        const id = args.id || (args.inputs.bucket as string)

        return { id, state: { ...args.inputs, bucket: id, arn: `arn:aws:s3:::${id}` } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:s3/getBucket:getBucket') {
            const bucket = args.inputs.bucket as string
            looked.push(bucket)

            return { bucket, id: bucket, arn: `arn:aws:s3:::${bucket}` }
        }
        return {}
    },
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const definition = (name: string) => ({ name, envKeyName: `${name.toUpperCase()}_BUCKET` })
const create = (
    buckets?: Parameters<typeof createBuckets>[1],
    bucketsRef?: Parameters<typeof createBuckets>[2],
) => createBuckets('test', buckets, bucketsRef)

describe('createBuckets', () => {
    test('is empty when the stack neither creates nor references one', () => {
        expect(create()).toEqual({})
    })

    test('names a created bucket with the environment alone, no project prefix', async () => {
        built.length = 0
        const buckets = create({ uploads: definition('uploads') })
        await settled(buckets.uploads.awsS3Bucket.arn)

        const bucket = built.find(r => r.type === 'aws:s3/bucket:Bucket')!
        expect([bucket.name, bucket.inputs.bucket]).toEqual(['uploads-test', 'uploads-test'])
    })

    test('resolves a ref given by name to a real bucket', async () => {
        looked.length = 0
        const buckets = create(undefined, { shared: definition('eldorado-assets') })

        expect(await settled(buckets.shared.awsS3Bucket.bucket)).toBe('eldorado-assets-test')
        expect(looked).toEqual([bucketName('eldorado-assets', 'test')])
    })

    test('a ref never spells the consumer project', async () => {
        looked.length = 0
        const buckets = create(undefined, { shared: definition('eldorado-assets') })
        await settled(buckets.shared.awsS3Bucket.arn)

        expect(looked.some(name => name.includes('proj'))).toBe(false)
    })

    test('fetches a ref given by id', async () => {
        const buckets = create(undefined, { outside: { id: 'someone-elses-bucket', envKeyName: 'OUTSIDE_BUCKET' } })

        expect(await settled(buckets.outside.awsS3Bucket.bucket)).toBe('someone-elses-bucket')
    })

    test('both ref forms sit in one record', async () => {
        const buckets = create(undefined, {
            shared: definition('eldorado-assets'),
            outside: { id: 'someone-elses-bucket', envKeyName: 'OUTSIDE_BUCKET' },
        })

        expect(Object.keys(buckets).sort()).toEqual(['outside', 'shared'])
    })

    test('passes an already-resolved result item straight through', () => {
        const existing: BucketsResult = create({ uploads: definition('uploads') })

        expect(create(undefined, existing).uploads).toBe(existing.uploads)
    })

    test('refuses to reference a bucket under the name of one it created', () => {
        expect(() => create({ uploads: definition('uploads') }, { uploads: definition('other') }))
            .toThrow(/Cannot create a ref bucket with the same name of an existing bucket: uploads/)
    })
})

describe('a granted bucket', () => {
    const grantFor = (buckets: BucketsResult) =>
        toLambdaResources({ buckets } as any, {
            name: 'fn',
            resources: { bucket: { uploads: ['s3:GetObject'] } },
        })

    test('grants the bucket and its objects, and publishes the name', async () => {
        const [grant] = grantFor(create({ uploads: definition('uploads') }))

        expect(grant.bucket!.envKeyName).toBe('UPLOADS_BUCKET')
        expect(await settled(grant.bucket!.awsS3Bucket.bucket)).toBe('uploads-test')
        expect(await settled(grant.bucket!.awsS3Bucket.arn)).toBe('arn:aws:s3:::uploads-test')
    })

    test('is refused by name when the stack carries no such bucket', () => {
        expect(() => grantFor(create())).toThrow(/needs bucket 'uploads'/)
    })

    test('a name no bucket answers to is reported with the other diagnostics', () => {
        const diagnostics = createDiagnostics()
        const context = { buckets: create({ uploads: definition('uploads') }) } as any

        for (const missing of findMissingGrants(context, {
            name: 'fn',
            resources: { bucket: { ghost: ['s3:GetObject'] } },
        })) {
            diagnostics.missingResource(missing)
        }

        expect(() => diagnostics.throwIfIncomplete())
            .toThrow(/bucket 'ghost' — the stack has: uploads/)
    })
})

describe('what run() accepts', () => {
    // Compile-time. The runtime body only keeps the test runner honest.
    test('buckets to create and buckets to reference, by name or by id', () => {
        const args: LambadaRunArguments = {
            buckets: { uploads: { name: 'uploads', envKeyName: 'UPLOADS_BUCKET' } },
            bucketsRef: {
                shared: { name: 'eldorado-assets', envKeyName: 'ASSETS_BUCKET' },
                outside: { id: 'someone-elses-bucket', envKeyName: 'OUTSIDE_BUCKET' },
            },
        }

        expect(Object.keys(args.bucketsRef!)).toHaveLength(2)
    })

    test('a flow-shaped grant map naming a bucket', () => {
        const resources = { bucket: { uploads: ['s3:GetObject', 's3:PutObject'] } } as const

        expect(resources.bucket.uploads).toHaveLength(2)
    })
})
