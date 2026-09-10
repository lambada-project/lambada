import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createKMSKeys, createSecrets } from '.'

const built: { type: string, inputs: any }[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ type: args.type, inputs: args.inputs })
        const id = args.id || `${args.name}-id`

        return { id, state: { ...args.inputs, arn: `arn:${id}`, keyId: id } }
    },
    call: () => ({}),
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const keys = () => createKMSKeys('proj', 'test', { data: { name: 'data', envKeyName: 'DATA_KEY_ARN' } }, undefined)

describe('a secret with an encryption key', () => {
    test('is encrypted with that key, by arn', async () => {
        const secrets = createSecrets(
            'proj',
            'test',
            { stripe: { name: 'stripe', envKeyName: 'STRIPE', encryptionKeyName: 'data' } },
            undefined,
            keys(),
        )

        expect(await settled(secrets.stripe.kmsKey!.arn)).toBe('arn:proj-data-test-id')

        await settled(secrets.stripe.awsSecret.arn)
        const secret = built.find(r => r.type === 'aws:secretsmanager/secret:Secret')!
        expect(await settled(secret.inputs.kmsKeyId)).toBe('arn:proj-data-test-id')
    })

    test('names no key when the definition names none', async () => {
        built.length = 0
        const secrets = createSecrets('proj', 'test', { stripe: { name: 'stripe', envKeyName: 'STRIPE' } }, undefined, keys())
        await settled(secrets.stripe.awsSecret.arn)

        expect(secrets.stripe.kmsKey).toBeUndefined()
        expect(built.find(r => r.type === 'aws:secretsmanager/secret:Secret')!.inputs.kmsKeyId).toBeUndefined()
    })

    test('names no key when the stack passes none', () => {
        const secrets = createSecrets('proj', 'test', {
            stripe: { name: 'stripe', envKeyName: 'STRIPE', encryptionKeyName: 'data' },
        })

        expect(secrets.stripe.kmsKey).toBeUndefined()
    })
})
