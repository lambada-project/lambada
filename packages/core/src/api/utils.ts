import * as AWS from "aws-sdk"
import { Request } from '@pulumi/awsx/apigateway/api'
import { EmbroideryRequest } from ".";

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
        throw 'Invalid request'

    const body = tryGetBody<TBody>(request)
    if (!body)
        throw 'Invalid request'
    return body
}

type AuthenticatedUser = {}
async function _FindUser(userPoolId: string, userId?: string, username?: string): Promise<AuthenticatedUser> {
    //@ts-ignore
    global.globalCognitoIdp = global.globalCognitoIdp ?? new AWS.CognitoIdentityServiceProvider({ apiVersion: '2016-04-18' });
    //@ts-ignore
    global.globalUserCacheBySub = global.globalUserCacheBySub ?? new Map<string, AuthenticatedUser>()
    //@ts-ignore
    global.globalUserCacheByUsername = global.globalUserCacheByUsername ?? new Map<string, AuthenticatedUser>()

    //@ts-ignore
    const cognitoIdp = global.globalCognitoIdp as AWS.CognitoIdentityServiceProvider
    //@ts-ignore
    const userCacheBySub = global.globalUserCacheBySub as Map<string, AuthenticatedUser>
    //@ts-ignore
    const userCacheByUsername = global.globalUserCacheByUsername as Map<string, AuthenticatedUser>

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
            }).promise()

            if (!cu) throw 'User not found'
            if (!cu.UserAttributes) throw 'User has no attributes'

            //TODO Pass environment
            var cutomAttributes = cu.UserAttributes.filter(x => x.Name.startsWith('dev:custom:'))
            userId = cu.UserAttributes.find(x => x.Name == 'sub')?.Value;
            var email = cu.UserAttributes.find(x => x.Name == 'email')?.Value

            if (!userId) throw 'Invalid user, has no sub'

            user = {
                id: userId,
                username,
                email: email ?? '',
                attributes: cutomAttributes
            }

        }
        else if (userId) {
            console.log('getting user by userId', userId)
            const cusers = await cognitoIdp.listUsers({
                UserPoolId: userPoolId,
                Filter: `sub = "${userId}"`
            }).promise()

            if (cusers && cusers.Users && cusers.Users.length > 0) {
                const cu = cusers.Users[0]
                if (!cu) throw 'User not found'
                if (!cu.Attributes) throw 'User has no attributes'

                var cutomAttributes = cu.Attributes.filter(x => x.Name.startsWith('dev:custom:'));
                var sub = cu.Attributes.find(x => x.Name == 'sub')?.Value;
                username = cu.Attributes.find(x => x.Name == 'username')?.Value
                var email = cu.Attributes.find(x => x.Name == 'email')?.Value

                if (!sub) throw 'Invalid user, has no sub'
                if (!username) throw 'Wallet is empty'

                user = {
                    id: sub,
                    attributes: cutomAttributes,
                    username,
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

    const claims = request?.requestContext?.authorizer?.claims

    if (claims) {

        const poolId = claims['iss'].split('/').pop()
        const userSub = claims['sub'];
        const username = claims['cognito:username'];
        const email = claims['email']

        // const accessToken = request?.headers['Authorization']
        // const hashedAccessToken = 'SESSION_02' // TODO: 
        //hash.update(accessToken, "utf8").digest('hex');

        const userIp = request.requestContext.identity.sourceIp
        
        return {
            userId: userSub ?? undefined,
            poolId: poolId ?? undefined,
            email: email ?? undefined,
            username: username,
            clientIP: userIp
        }
    }
    else {
        return undefined;
    }
}



export interface AuthExecutionContext {
    userId?: string
    email?: string
    username?: string

    poolId?: string
    clientIP: string
}