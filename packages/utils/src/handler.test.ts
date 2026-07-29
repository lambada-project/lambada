import { describe, test, expect } from 'bun:test'
import { createHandler, WrappableContext } from './handler'
import { Request } from './request'

const makeRequest = (overrides?: {
    origin?: string
    accountId?: string
    headers?: { [name: string]: string | undefined }
}): Request => ({
    httpMethod: 'GET',
    path: '/thing',
    headers: {
        ...(overrides?.origin ? { origin: overrides.origin } : {}),
        ...(overrides?.headers ?? {})
    },
    requestContext: {
        accountId: overrides?.accountId ?? '123456789012',
        authorizer: null,
        identity: { sourceIp: '1.2.3.4', userAgent: 'test-agent' }
    },
    body: null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/thing'
} as unknown as Request)

const makeContext = (): WrappableContext => ({ callbackWaitsForEmptyEventLoop: true })

describe('createHandler', () => {
    test('wraps a plain result into a 200 with CORS headers', async () => {
        const handler = createHandler(async () => ({ ok: true }))

        const response = await handler(makeRequest(), makeContext())

        expect(response.statusCode).toBe(200)
        expect(response.body).toBe('{"ok":true}')
        expect(response.headers?.['Access-Control-Allow-Origin']).toBe('*')
    })

    test('passes a full response through, stringifying a non-string body', async () => {
        const handler = createHandler(async () => ({ statusCode: 201, body: { id: 7 } }))

        const response = await handler(makeRequest(), makeContext())

        expect(response.statusCode).toBe(201)
        expect(response.body).toBe('{"id":7}')
    })

    test("a handler's own headers win over the wrapper's", async () => {
        const handler = createHandler(
            async () => ({ statusCode: 200, body: 'x', headers: { 'x-thing': 'from-handler' } }),
            { extraHeaders: { 'x-thing': 'from-config' } }
        )

        const response = await handler(makeRequest(), makeContext())

        expect(response.headers?.['x-thing']).toBe('from-handler')
    })

    test('applies cacheControl and extraHeaders from config', async () => {
        const handler = createHandler(async () => ({ ok: true }), {
            cacheControl: 'max-age=60',
            extraHeaders: { 'x-extra': 'yes' }
        })

        const response = await handler(makeRequest(), makeContext())

        expect(response.headers?.['cache-control']).toBe('max-age=60')
        expect(response.headers?.['x-extra']).toBe('yes')
    })

    /**
     * Regression: the wrapper used to merge each request's CORS headers into a variable captured by
     * its closure, so on a warm container the first request's allowed origin survived into every
     * later one. `getCorsHeaders` only ever returns an allowlisted value, so this misroutes among
     * trusted origins rather than admitting an untrusted one -- a correctness bug, not a CORS bypass.
     */
    test('does not leak CORS headers between invocations on a warm container', async () => {
        const config = { cors: { origins: ['https://a.example', 'https://b.example'] } }
        const handler = createHandler(async () => ({ ok: true }), config)

        const first = await handler(makeRequest({ origin: 'https://a.example' }), makeContext())
        const second = await handler(makeRequest({ origin: 'https://b.example' }), makeContext())

        expect(first.headers?.['Access-Control-Allow-Origin']).toBe('https://a.example')
        expect(second.headers?.['Access-Control-Allow-Origin']).toBe('https://b.example')
    })

    test('does not mutate the config it was given', async () => {
        const config = { cors: { origins: ['https://a.example'] }, extraHeaders: { 'x-extra': 'yes' } }
        const handler = createHandler(async () => ({ ok: true }), config)

        await handler(makeRequest({ origin: 'https://a.example' }), makeContext())

        expect(config.extraHeaders).toEqual({ 'x-extra': 'yes' })
    })

    test('sets callbackWaitsForEmptyEventLoop only when configured', async () => {
        const untouched = makeContext()
        await createHandler(async () => ({}))(makeRequest(), untouched)
        expect(untouched.callbackWaitsForEmptyEventLoop).toBe(true)

        const configured = makeContext()
        await createHandler(async () => ({}), { callbackWaitsForEmptyEventLoop: false })(makeRequest(), configured)
        expect(configured.callbackWaitsForEmptyEventLoop).toBe(false)
    })

    test('hides error detail by default and reveals it when the error opts in', async () => {
        const boom = Object.assign(new Error('kaboom'), { code: 'BOOM', statusCode: 418 })

        const hidden = await createHandler(async () => { throw new Error('kaboom') })(makeRequest(), makeContext())
        expect(hidden.statusCode).toBe(500)
        expect(JSON.parse(hidden.body).error).toBe('Bad Request')

        const shown = await createHandler(async () => { throw Object.assign(boom, { showError: true }) })(
            makeRequest(), makeContext()
        )
        expect(shown.statusCode).toBe(418)
        expect(JSON.parse(shown.body).error).toEqual({ message: 'kaboom', code: 'BOOM' })
        expect(JSON.parse(shown.body).errors).toHaveLength(1)
    })

    test('injects a mock user only for the LocalStack account', async () => {
        process.env.IS_LOCALSTACK = 'true'
        try {
            const seen: (string | undefined)[] = []
            const handler = createHandler(async ({ user }) => {
                seen.push(user?.username)
                return {}
            })

            const mockHeaders = { 'x-mock-user-id': 'u-1', 'x-mock-username': 'josh' }
            await handler(makeRequest({ accountId: '000000000000', headers: mockHeaders }), makeContext())
            await handler(makeRequest({ accountId: '123456789012', headers: mockHeaders }), makeContext())

            expect(seen).toEqual(['josh', undefined])
        } finally {
            delete process.env.IS_LOCALSTACK
        }
    })
})
