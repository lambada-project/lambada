import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createKMSKeys } from '.'
import { createSecrets, SecretsResult } from './secrets'

const built: { type: string, inputs: any }[] = []
/** Every secret a ref looked up. */
const looked: string[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ type: args.type, inputs: args.inputs })
        const id = args.id || `${args.name}-id`

        return { id, state: { ...args.inputs, arn: `arn:${id}`, keyId: id } }
    },
    call: (args: pulumi.runtime.MockCallArgs) => {
        if (args.token === 'aws:secretsmanager/getSecret:getSecret') {
            const name = args.inputs.name as string
            looked.push(name)

            return { name, id: `${name}-id`, arn: `arn:${name}` }
        }
        return {}
    },
})

const settled = <T>(o: pulumi.Input<T>): Promise<T> =>
    (pulumi.output(o) as unknown as { promise(): Promise<T> }).promise()

const definition = (name: string, envKeyName: string) => ({ name, envKeyName })
const keys = () => createKMSKeys('proj', 'test', { data: { name: 'data', envKeyName: 'DATA_KEY_ARN' } }, undefined)

const secretBuilt = () => built.find(r => r.type === 'aws:secretsmanager/secret:Secret')!

describe('createSecrets', () => {
    test('prefixes a secret it creates with its own project', async () => {
        const secrets = createSecrets('proj', 'test', { token: definition('token', 'TOKEN') })

        expect(await settled(secrets.token.awsSecret.name)).toBe('proj-token-test')
    })

    test('looks a ref up by the full name it was given, not the consumer project', async () => {
        looked.length = 0
        const secrets = createSecrets('proj', 'test', undefined, { shared: definition('eldorado-token', 'TOKEN') })
        await settled(secrets.shared.awsSecret.id)

        expect(looked).toContain('eldorado-token-test')
        expect(looked.some(name => name.includes('proj'))).toBe(false)
    })

    test('the owner and ref conventions meet', async () => {
        const owned = createSecrets('eldorado', 'test', { token: definition('token', 'TOKEN') })

        looked.length = 0
        const referenced = createSecrets('proj', 'test', undefined, { token: definition('eldorado-token', 'TOKEN') })
        await settled(referenced.token.awsSecret.id)

        expect(looked).toContain(await settled(owned.token.awsSecret.name))
    })

    test('passes an already-resolved result item straight through', () => {
        const existing = createSecrets('eldorado', 'test', { token: definition('token', 'TOKEN') })

        expect(createSecrets('proj', 'test', undefined, existing satisfies SecretsResult).token).toBe(existing.token)
    })

    test('refuses to reference a secret under the name of one it created', () => {
        expect(() => createSecrets('proj', 'test', { token: definition('token', 'A') }, { token: definition('token', 'B') }))
            .toThrow(/Cannot create a ref secret with the same name of an existing secret: token/)
    })
})

describe('a secret with an encryption key', () => {
    test('is encrypted with that key, by arn', async () => {
        built.length = 0
        const secrets = createSecrets(
            'proj',
            'test',
            { stripe: { name: 'stripe', envKeyName: 'STRIPE', encryptionKeyName: 'data' } },
            undefined,
            keys(),
        )

        expect(await settled(secrets.stripe.kmsKey!.arn)).toBe('arn:proj-data-test-id')

        await settled(secrets.stripe.awsSecret.arn)
        expect(await settled(secretBuilt().inputs.kmsKeyId)).toBe('arn:proj-data-test-id')
    })

    test('names no key when the definition names none', async () => {
        built.length = 0
        const secrets = createSecrets('proj', 'test', { stripe: { name: 'stripe', envKeyName: 'STRIPE' } }, undefined, keys())
        await settled(secrets.stripe.awsSecret.arn)

        expect(secrets.stripe.kmsKey).toBeUndefined()
        expect(secretBuilt().inputs.kmsKeyId).toBeUndefined()
    })

    test('names no key when the stack passes none', () => {
        const secrets = createSecrets('proj', 'test', {
            stripe: { name: 'stripe', envKeyName: 'STRIPE', encryptionKeyName: 'data' },
        })

        expect(secrets.stripe.kmsKey).toBeUndefined()
    })
})
