import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { createSecrets, SecretsResult } from './secrets'

const looked: string[] = []

pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => ({
        id: `${args.name}-id`,
        state: { ...args.inputs, arn: `arn:${args.name}` },
    }),
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
