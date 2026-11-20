// Preloaded by bun (bunfig.toml): creates the stack's table in AWS Emulator before the tests run.
import { afterAll, beforeAll } from 'bun:test'
import { ConfigureAwsEnvironment, RemoveResources, type LambadaEnvironmentConfig } from '@lambada/core'
import { tables } from '../src/resources'

const endpoint = process.env.AWS_ENDPOINT_URL
if (!endpoint) throw new Error('AWS_ENDPOINT_URL is not set: run the tests with `npm test`, which starts AWS Emulator.')

const emulator = {
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
}

const config: LambadaEnvironmentConfig = {
    options: {
        environment: 'test',
        aws: { dynamodb: emulator },
        tables,
    },
}

// Creating and deleting tables waits until DynamoDB reports them ACTIVE, or gone.
beforeAll(() => ConfigureAwsEnvironment(config), 60_000)
afterAll(() => RemoveResources(config), 60_000)
