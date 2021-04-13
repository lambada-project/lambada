import { Request } from '@pulumi/awsx/apigateway/api'
import { EmbroideryRequest } from "../api";
import { getContext } from '@lambada/utils';

export const getMockRequest = (authenticated: boolean, body?: any): EmbroideryRequest => {
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
        multiValueQueryStringParameters: null,
        queryStringParameters: null,
        resource: '',
        stageVariables: null,
        headers: {
            'Authorization': "Bearer 11111111"
        },
    } as Request

    return {
        request: request,
        user: getContext(request),
    }
}
