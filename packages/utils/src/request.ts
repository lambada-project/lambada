import * as awslambda from "aws-lambda"
import { LambadaError } from "./error";
import * as crypto from 'node:crypto'


export declare type Request = awslambda.APIGatewayProxyEvent;

export function tryGetBody<TBody>(request: Request): TBody | undefined {
    if (!request.body) return undefined;

    var requestData: any = request.body;
    if (request.isBase64Encoded) {
        requestData = Buffer.from(request.body, 'base64').toString()
    }
    return JSON.parse(requestData) as TBody
}

export function getBody<TBody>(request: Request): TBody {
    if (!request.body)
        throw new LambadaError('Request does not contain a body.')

    const body = tryGetBody<TBody>(request)
    if (!body)
        throw new LambadaError('Request does not contain a body.')
    return body
}

export function getContext(request: Request): AuthExecutionContext | undefined {
    if (!request) {
        throw 'Server error'
    }

    //const claims = request?.requestContext?.authorizer?.claims
    const claims: { [key: string]: any } = { ...(request?.requestContext?.authorizer ?? {}), ...(request?.requestContext?.authorizer?.claims ?? {}) }


    const poolId = claims['iss']?.split('/').pop()
    const userSub = claims['sub'];
    const username = claims['username'] ?? claims['cognito:username'];
    const email = claims['email']

    const AuthorizationToken = request?.headers['Authorization']
    const hashedAuthorizationToken = AuthorizationToken ? crypto.createHash('sha256').update(AuthorizationToken).digest('hex') : 'EMPTY'

    const userIp = request.requestContext.identity.sourceIp

    return {
        userId: userSub ?? undefined,
        poolId: poolId ?? undefined,
        email: email ?? undefined,
        username: username,
        hashedAuthorizationToken: hashedAuthorizationToken,
        clientIP: userIp,
        userAgent: request.requestContext.identity.userAgent,
        jti: claims['jti'],
        claims: claims
    }
}



export interface AuthExecutionContext {
    userId?: string
    email?: string
    username?: string

    hashedAuthorizationToken?: string

    poolId?: string
    clientIP?: string | null
    userAgent?: string | null
    jti?: string | null

    claims: { [key: string]: string }
}
