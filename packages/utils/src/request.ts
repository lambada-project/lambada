import * as awslambda from "aws-lambda"
import { LambadaError } from "./error";
import { AttributeType, CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider'
import * as crypto from 'crypto'


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

export async function isUserInGroup(user: { username?: string, poolId?: string }, groupName: string) {
    if (!user.username) throw new LambadaError('[isUserInGroup] username is mandatory')
    if (!user.poolId) throw new LambadaError('[isUserInGroup] poolId is mandatory')

           /**
         claims: {
            claims: {

            'cognito:groups': 'GROUP,GROUP,GROUP',
      
         */
    const cognito = new CognitoIdentityProvider({ apiVersion: '2016-04-18' });
    const groups = await cognito.adminListGroupsForUser({
        Username: user.username,
        UserPoolId: user.poolId
    })

    return typeof groups.Groups?.find(x => x.GroupName == groupName) !== 'undefined'
}

type AuthenticatedUser = {
    id: string
    attributes: AttributeType[]
    username: string
    name?: string
    email: string
    enabled?: boolean
}

declare global {
    namespace NodeJS {
        interface Global {
            globalCognitoIdp?: CognitoIdentityProvider;
            globalUserCacheBySub?: Map<string, AuthenticatedUser>;
            globalUserCacheByUsername?: Map<string, AuthenticatedUser>;
        }
    }
}

async function _FindUser(userPoolId: string, userId?: string, username?: string): Promise<AuthenticatedUser> {
    
    global.globalCognitoIdp = global.globalCognitoIdp ?? new CognitoIdentityProvider({ apiVersion: '2016-04-18' });
    global.globalUserCacheBySub = global.globalUserCacheBySub ?? new Map<string, AuthenticatedUser>()
    global.globalUserCacheByUsername = global.globalUserCacheByUsername ?? new Map<string, AuthenticatedUser>()

    const cognitoIdp = global.globalCognitoIdp!
    const userCacheBySub = global.globalUserCacheBySub!
    const userCacheByUsername = global.globalUserCacheByUsername!

    const a = Date.now()

    if (!userPoolId) throw 'Invalid userPoolId'

    let user: AuthenticatedUser | undefined

    if (username) user = userCacheByUsername.get(username)
    if (userId) user = userCacheBySub.get(userId)

    if (!user) {
        console.log('user not in cache')
        if (username) {
            console.log('getting user by username', username)
            const cu = await cognitoIdp.adminGetUser({
                UserPoolId: userPoolId,
                Username: username
            })

            if (!cu) throw 'User not found'
            if (!cu.UserAttributes) throw 'User has no attributes'

            //TODO Pass environment
            var cutomAttributes = cu.UserAttributes.filter(x => x.Name?.startsWith('dev:custom:'))
            userId = cu.UserAttributes.find(x => x.Name == 'sub')?.Value;
            var email = cu.UserAttributes.find(x => x.Name == 'email')?.Value
            var name = cu.UserAttributes.find(x => x.Name == 'name')?.Value

            if (!userId) throw 'Invalid user, has no sub'

            user = {
                id: userId,
                username,
                name,
                email: email ?? '',
                enabled: cu.Enabled,
                attributes: cutomAttributes
            }

        }
        else if (userId) {
            console.log('getting user by userId', userId)
            const cusers = await cognitoIdp.listUsers({
                UserPoolId: userPoolId,
                Filter: `sub = "${userId}"`
            })

            if (cusers && cusers.Users && cusers.Users.length > 0) {
                const cu = cusers.Users[0]
                if (!cu) throw 'User not found'
                if (!cu.Attributes) throw 'User has no attributes'

                username = cu.Username

                var cutomAttributes = cu.Attributes.filter(x => x.Name?.startsWith('dev:custom:'));
                var sub = cu.Attributes.find(x => x.Name == 'sub')?.Value;
                var name = cu.Attributes.find(x => x.Name == 'name')?.Value
                var email = cu.Attributes.find(x => x.Name == 'email')?.Value

                if (!sub) throw 'Invalid user, has no sub'
                if (!username) throw 'username is empty'

                user = {
                    id: sub,
                    attributes: cutomAttributes,
                    name,
                    username,
                    enabled: cu.Enabled,
                    email: email ?? ''
                }
            }
        }

        if (!userId) throw 'Invalid user, has no sub'
        if (!username) throw 'username is empty'
        if (!user) throw 'Could not find user'

        userCacheBySub.set(userId, user)
        userCacheByUsername.set(username, user)
    }

    var b = Date.now();
    console.log('found user', user)
    console.log('adminGetUser (ms): ', (b - a))

    return user
}

export async function getUserById(userId: string, poolId: string): Promise<AuthenticatedUser> {
    const user = await _FindUser(poolId, userId)
    return user
}

export async function getUser(username: string, context: AuthExecutionContext): Promise<AuthenticatedUser> {
    const user = await _FindUser(context.poolId ?? '', undefined, username)
    return user
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