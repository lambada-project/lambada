import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambadaRunArguments } from '..'
import { createDiagnostics } from '../resources/diagnostics'
import { findMissingGrants, toLambdaResources } from '../resources/grants'
import { bucketName, BucketsResult, createBuckets } from '.'
import { resourceStatements } from '../lambdas'

const built: { name: string, type: string, id?: string, inputs: any }[] = []
const looked: string[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ name: args.name, type: args.type, id: args.id, inputs: args.inputs })
        if (args.type === 'aws:cloudfront/distribution:Distribution') {
            return { id: 'E1', state: { ...args.inputs, arn: 'arn:aws:cloudfront::123456789012:distribution/E1', domainName: 'd1.cloudfront.net' } }
        }
        if (args.type === 'aws:cloudfront/originAccessControl:OriginAccessControl') return { id: 'oac-1', state: args.inputs }
        // A bucket's id is its name: `args.id` on a `.get`, the `bucket` input on a create.
        const id = args.id || (args.inputs.bucket as string)

        return { id, state: { ...args.inputs, bucket: id, arn: `arn:aws:s3:::${id}`, bucketRegionalDomainName: `${id}.s3.us-east-1.amazonaws.com` } }
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
            .toThrow(/Cannot add the bucket or prefix .uploads.: the stack already has/)
    })
})

describe('a hardened bucket', () => {
    const built0 = (type: string) => built.filter(r => r.type === type)
    /** The hardening resources have no output anyone awaits. */
    const drain = async () => {
        for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
    }

    test('blocks public access and denies insecure transport', async () => {
        built.length = 0
        const buckets = create({ uploads: definition('uploads') })
        await settled(buckets.uploads.awsS3Bucket.arn)
        await drain()

        expect(built0('aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock')).toHaveLength(1)
        expect(built0('aws:s3/bucketPolicy:BucketPolicy')).toHaveLength(1)

        const policy = JSON.parse(await settled(built0('aws:s3/bucketPolicy:BucketPolicy')[0].inputs.policy))
        expect(policy.Statement[0]).toMatchObject({
            Sid: 'DenyInsecureTransport',
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        })
        expect(policy.Statement[0].Resource).toEqual(['arn:aws:s3:::uploads-test', 'arn:aws:s3:::uploads-test/*'])
    })

    test('is left alone when the definition opts out', async () => {
        built.length = 0
        const buckets = create({ uploads: { ...definition('uploads'), hardened: false } })
        await settled(buckets.uploads.awsS3Bucket.arn)
        await drain()

        expect(built0('aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock')).toHaveLength(0)
        expect(built0('aws:s3/bucketPolicy:BucketPolicy')).toHaveLength(0)
    })

    test('refuses to replace a policy the definition gave through options', () => {
        expect(() => create({ uploads: { ...definition('uploads'), options: { policy: '{}' } } }))
            .toThrow(/sets its own policy through options/)
    })

    test('leaves a referenced bucket alone', async () => {
        built.length = 0
        const buckets = create(undefined, { shared: definition('eldorado-assets') })
        await settled(buckets.shared.awsS3Bucket.arn)
        await drain()

        expect(built0('aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock')).toHaveLength(0)
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

const photos = (extra: object = {}) => ({
    photos: { ...definition('photos'), prefixes: { profiles: 'profiles/', visits: 'visits/' }, ...extra },
})

describe('a prefix', () => {
    test('is granted by its key, as a bucket narrowed to its keys', () => {
        const buckets = create(photos())

        expect(Object.keys(buckets)).toEqual(['photos', 'profiles', 'visits'])
        expect(buckets.profiles).toMatchObject({ prefix: 'profiles/', envKeyName: 'PHOTOS_BUCKET' })
        expect(buckets.profiles.awsS3Bucket).toBe(buckets.photos.awsS3Bucket)
        expect(buckets.photos.prefix).toBeUndefined()
    })

    test('shares the namespace of the buckets', () => {
        expect(() => create({ ...photos(), profiles: definition('profiles') }))
            .toThrow("Cannot add the bucket or prefix 'profiles'")
    })

    test.each([
        { prefix: '', problem: 'is empty' },
        { prefix: 'cat*', problem: 'holds a wildcard' },
        { prefix: '/profiles/', problem: "starts with '/'" },
    ])('refuses $prefix', ({ prefix, problem }) => {
        expect(() => create({ photos: { ...definition('photos'), prefixes: { profiles: prefix } } }))
            .toThrow(`Cannot declare the prefix 'profiles' of the bucket 'photos': '${prefix}' ${problem}`)
    })

    test('of a referenced bucket', () => {
        const buckets = create(undefined, { outside: { id: 'someone-elses-bucket', envKeyName: 'OUTSIDE_BUCKET', prefixes: { inbox: 'inbox/' } } })

        expect(buckets.inbox.prefix).toBe('inbox/')
    })
})

describe('a granted prefix', () => {
    const statementsOf = async (access: string[], extra?: object) => {
        const [grant] = toLambdaResources({ buckets: create(photos(extra)) } as any, { name: 'fn', resources: { bucket: { profiles: access as any } } })
        const { statements, envVars } = resourceStatements(grant, 'fn', 'test')
        return { statements: await settled(statements as any), envVars: await settled(envVars as any) }
    }

    test('reaches only the objects under it', async () => {
        const { statements, envVars } = await statementsOf(['s3:PutObject'])

        expect(statements).toEqual([{ Effect: 'Allow', Action: ['s3:PutObject'], Resource: 'arn:aws:s3:::photos-test/profiles/*' }])
        expect(envVars).toEqual({ PHOTOS_BUCKET: 'photos-test' })
    })

    test('lists only the keys under it', async () => {
        const { statements } = await statementsOf(['s3:GetObject', 's3:ListBucket'])

        expect(statements[0]).toMatchObject({ Action: ['s3:GetObject'] })
        expect(statements[1]).toEqual({
            Effect: 'Allow', Action: ['s3:ListBucket'], Resource: 'arn:aws:s3:::photos-test',
            Condition: { StringLike: { 's3:prefix': ['profiles/*'] } },
        })
    })

    test('a listing alone grants no object', async () => {
        const { statements } = await statementsOf(['s3:ListBucket'])

        expect(statements.map((s: any) => s.Resource)).toEqual(['arn:aws:s3:::photos-test'])
    })

    test.each(['s3:GetBucketLocation', 's3:GetBucketObjectLockConfiguration'])('refuses %s, which S3 applies to the whole bucket', async action => {
        await expect(statementsOf(['s3:GetObject', action])).rejects.toThrow(`fn: grants the prefix 'profiles/' ${action}, which S3 applies to the whole bucket`)
    })
})

describe('a bucket served through its cdn', () => {
    const built0 = (type: string) => built.filter(r => r.type === type)
    const drain = async () => {
        for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0))
    }
    const policyOf = async (buckets: BucketsResult) => {
        await settled(buckets.photos.cdn!.distribution.arn)
        await drain()
        return JSON.parse(await settled(built0('aws:s3/bucketPolicy:BucketPolicy')[0].inputs.policy))
    }

    test('reads through a distribution lambada builds, the one reader the bucket lets in', async () => {
        built.length = 0
        const policy = await policyOf(create(photos({ cdn: {} })))

        const [distribution] = built0('aws:cloudfront/distribution:Distribution')
        expect(distribution.inputs.origins).toEqual([{ originId: 'bucket', domainName: 'photos-test.s3.us-east-1.amazonaws.com', originAccessControlId: 'oac-1' }])
        expect(policy.Statement.map((s: any) => s.Sid)).toEqual(['DenyInsecureTransport', 'CdnReadsObjects'])
        expect(policy.Statement[1]).toEqual({
            Sid: 'CdnReadsObjects', Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject',
            Resource: 'arn:aws:s3:::photos-test/*',
            Condition: { StringEquals: { 'AWS:SourceArn': 'arn:aws:cloudfront::123456789012:distribution/E1' } },
        })
    })

    test('reads only the prefixes it names', async () => {
        built.length = 0
        const policy = await policyOf(create(photos({ cdn: { prefixes: ['profiles'] } })))

        expect(policy.Statement[1].Resource).toEqual(['arn:aws:s3:::photos-test/profiles/*'])
    })

    test('writes its policy on a bucket that is not hardened', async () => {
        built.length = 0
        const policy = await policyOf(create(photos({ cdn: {}, hardened: false })))

        expect(policy.Statement.map((s: any) => s.Sid)).toEqual(['CdnReadsObjects'])
        expect(built0('aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock')).toHaveLength(0)
    })

    test('publishes its domain to a function granted the bucket or one of its prefixes', async () => {
        const buckets = create(photos({ cdn: { envKeyName: 'PHOTOS_CDN' } }))
        for (const ref of ['photos', 'profiles']) {
            const [grant] = toLambdaResources({ buckets } as any, { name: 'fn', resources: { bucket: { [ref]: ['s3:GetObject'] } } })
            expect(await settled(resourceStatements(grant, 'fn', 'test').envVars as any)).toEqual({ PHOTOS_BUCKET: 'photos-test', PHOTOS_CDN: 'd1.cloudfront.net' })
        }
    })

    test('refuses a prefix the bucket does not declare', () => {
        expect(() => create(photos({ cdn: { prefixes: ['ghost'] } })))
            .toThrow("it names the prefix 'ghost', which the bucket does not declare. It declares: profiles, visits.")
    })

    test('refuses a policy given through options', () => {
        expect(() => create(photos({ cdn: {}, hardened: false, options: { policy: '{}' } }))).toThrow(/sets its own policy through options/)
    })

    test('refuses a referenced bucket', () => {
        expect(() => create(undefined, { shared: { ...definition('shared'), cdn: {} } })).toThrow("Cannot serve the referenced bucket 'shared'")
    })
})
