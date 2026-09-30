import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { LambdaResource, resourceStatements } from '.'

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const kinds: Record<string, Omit<LambdaResource, 'access'>> = {
    bucket: { bucket: { envKeyName: 'UPLOADS', awsS3Bucket: { arn: 'arn:s3:::uploads', bucket: 'uploads' } } as never },
    topic: { topic: { envKeyName: 'EVENTS', ref: { arn: 'arn:sns:events' } } as never },
    queue: { queue: { envKeyName: 'JOBS', ref: { arn: 'arn:sqs:jobs', url: 'https://sqs/jobs' } } as never },
    secret: { secret: { definition: { envKeyName: 'TOKEN' }, awsSecret: { arn: 'arn:secret:token', name: 'token' } } as never },
    kmsKey: { kmsKey: { definition: { envKeyName: 'KEY' }, awsKmsKey: { arn: 'arn:kms:key' } } as never },
    pool: { pool: { envKeyName: 'POOL', ref: { id: 'pool-id', arn: 'arn:cognito:pool' } } as never },
    arn: { arn: 'arn:any' },
}

describe('a grant', () => {
    test.each(Object.keys(kinds))('on a %s is one statement of its actions', kind => {
        const { statements } = resourceStatements({ ...kinds[kind], access: ['x:Do'] }, 'fn', 'test')

        expect(statements).toHaveLength(1)
        expect(statements[0]).toMatchObject({ Action: ['x:Do'], Effect: 'Allow' })
    })

    test('on a bucket names the bucket and its objects, and publishes the bucket name', async () => {
        const { statements, envVars } = resourceStatements({ ...kinds.bucket, access: ['s3:GetObject'] }, 'fn', 'test')

        expect(await settled(statements[0].Resource as pulumi.Input<string[]>)).toEqual(['arn:s3:::uploads', 'arn:s3:::uploads/*'])
        expect(envVars).toEqual({ UPLOADS: 'uploads' })
    })
})
