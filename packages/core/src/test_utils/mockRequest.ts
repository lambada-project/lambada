import { Request } from '@pulumi/awsx/classic/apigateway/api'
import { EmbroideryRequest } from "../api";
import { getContext } from '@lambada/utils';

/** A query as a client sends it (`?ids=a&ids=b`), or by key with a value or the values of a repeated key. */
export type MockQuery = string | Record<string, string | readonly string[]>

/**
 * The two query maps API Gateway hands a Lambda proxy integration, as measured on a REST API: the
 * single map keeps a repeated key's last value, the multi-value map keeps every value in order, a key
 * with no `=` reads as `''`, values arrive decoded, and with no query both maps are null.
 */
export const queryMaps = (query: MockQuery | undefined): Pick<Request, 'queryStringParameters' | 'multiValueQueryStringParameters'> => {
    const pairs: [string, string][] = typeof query === 'string'
        ? query.replace(/^\?/, '').split('&').filter(part => part !== '').map(part => {
            const at = part.indexOf('=')
            const [key, value] = at === -1 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)]
            return [decodeURIComponent(key), decodeURIComponent(value)]
        })
        : Object.entries(query ?? {}).flatMap(([key, values]) =>
            (typeof values === 'string' ? [values] : values).map((value): [string, string] => [key, value]))

    if (pairs.length === 0) return { queryStringParameters: null, multiValueQueryStringParameters: null }

    const multi: Record<string, string[]> = {}
    for (const [key, value] of pairs) multi[key] = [...(multi[key] ?? []), value]
    return {
        queryStringParameters: Object.fromEntries(Object.entries(multi).map(([key, values]) => [key, values[values.length - 1]])),
        multiValueQueryStringParameters: multi,
    }
}

export const getMockRequest = (authenticated: boolean, body?: any, query?: MockQuery): EmbroideryRequest => {
    const request = {
        requestContext: {
            authorizer: {
                claims: {
                    'iss': 'something/eu-west-1_v6igPOxzr', //dev poolid
                    'cognito:username': 'andreujuanc' //a valid user
                }
            },
            identity: {
                sourceIp: '127.0.0.1',
            } as any,
            httpMethod: 'MOCK',
            path: '/mock',
            accountId: '',
            apiId: '1',
            protocol: '',
            stage: '',
            requestId: '',
            requestTimeEpoch: Date.now(),
            resourceId: '',
            resourcePath: '/'
        },
        body: body ? JSON.stringify(body) : null,
        httpMethod: 'MOCK',
        path: '/mock',
        isBase64Encoded: false,
        pathParameters: {},
        multiValueHeaders: {},
        ...queryMaps(query),
        resource: '',
        stageVariables: null,
        headers: {
            'Authorization': "Bearer 11111111"
        },
    } as Request

    return {
        request: request,
        user: getContext(request),
        context: {} as any
    }
}
