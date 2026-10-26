import { describe, expect, test } from 'bun:test'
import * as pulumi from '@pulumi/pulumi'
import { requireSignatures, withSignedRoutes } from './sigv4'

const apiKey = { type: 'apiKey', name: 'x-api-key', in: 'header' }
const sigv4 = { type: 'apiKey', name: 'Authorization', in: 'header', 'x-amazon-apigateway-authtype': 'awsSigv4' }
const signed = { 'x-amazon-apigateway-auth': { type: 'AWS_IAM' } }

const swagger = () => ({
    paths: {
        '/pets/{id}': {
            get: { ...signed },
            delete: { ...signed, security: [{ api_key: [] }] },
        },
        '/stores': {
            get: { security: [{ userPool: [] }] },
        },
    },
    securityDefinitions: { api_key: apiKey, userPool: { type: 'apiKey' } },
})

describe('a signed route', () => {
    test('requires a signature, as an imported REST API enforces it', () => {
        expect(requireSignatures(swagger()).paths!['/pets/{id}'].get).toEqual({ security: [{ sigv4: [] }] })
    })

    test('requires its API key in the same requirement, so a request carries both', () => {
        expect(requireSignatures(swagger()).paths!['/pets/{id}'].delete).toEqual({ security: [{ sigv4: [], api_key: [] }] })
    })

    test('defines the signature next to the definitions already there', () => {
        expect(requireSignatures(swagger()).securityDefinitions).toEqual({ api_key: apiKey, userPool: { type: 'apiKey' }, sigv4 })
    })
})

describe('an API without a signed route', () => {
    test('is left as it was', () => {
        const unsigned = { paths: { '/stores': { get: { security: [{ userPool: [] }] } } }, securityDefinitions: { userPool: {} } }

        expect(requireSignatures(structuredClone(unsigned))).toEqual(unsigned)
    })

    test('an unsigned route of an API with signed ones is left as it was', () => {
        expect(requireSignatures(swagger()).paths!['/stores'].get).toEqual({ security: [{ userPool: [] }] })
    })
})

describe('the transform', () => {
    const opts = { parent: undefined } as never
    const resolved = <T>(output: pulumi.Output<T>) => new Promise<T>(resolve => output.apply(resolve))

    test('rewrites the body of the REST API', async () => {
        const result = withSignedRoutes({ resource: undefined as never, type: 'aws:apigateway/restApi:RestApi', name: 'api', props: { name: 'api', body: JSON.stringify(swagger()) }, opts })

        expect(result!.props.name).toBe('api')
        expect(JSON.parse(await resolved(result!.props.body))).toEqual(requireSignatures(swagger()))
    })

    test('leaves every other resource of the API alone', async () => {
        expect(withSignedRoutes({ resource: undefined as never, type: 'aws:apigateway/deployment:Deployment', name: 'd', props: {}, opts })).toBeUndefined()
    })
})
