import { AttributeType, CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider'
import { LambadaError } from "./error.js";
import { AuthExecutionContext } from "./request.js";

/**
 * Cognito-backed user lookups.
 *
 * Kept apart from `./request` so that `getContext` — which only parses the incoming event — does not
 * drag the Cognito client into modules that merely need the auth context. A bundled Lambda that never
 * looks a user up therefore never pulls in `@aws-sdk/client-cognito-identity-provider`.
 */

export async function isUserInGroup(
    context: AuthExecutionContext,
    groupName: string
) {

    if (!context.username) throw new LambadaError('[isUserInGroup] username is mandatory')
    if (!context.poolId) throw new LambadaError('[isUserInGroup] poolId is mandatory')

    // We save a bit if we check the claims first
    const claimGroups = context.claims['cognito:groups']?.split(',')
    if (claimGroups && claimGroups.includes(groupName)) {
        return true
    }

    const cognito = new CognitoIdentityProvider({ apiVersion: '2016-04-18' });
    const groups = await cognito.adminListGroupsForUser({
        Username: context.username,
        UserPoolId: context.poolId
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
    namespace globalThis {
        var globalCognitoIdp: CognitoIdentityProvider | undefined;
        var globalUserCacheBySub: Map<string, AuthenticatedUser> | undefined;
        var globalUserCacheByUsername: Map<string, AuthenticatedUser> | undefined;
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
            var customAttributes = cu.UserAttributes.filter(x => x.Name?.startsWith('custom:'))
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
                attributes: customAttributes
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

                var customAttributes = cu.Attributes.filter(x => x.Name?.startsWith('custom:'));
                var sub = cu.Attributes.find(x => x.Name == 'sub')?.Value;
                var name = cu.Attributes.find(x => x.Name == 'name')?.Value
                var email = cu.Attributes.find(x => x.Name == 'email')?.Value

                if (!sub) throw 'Invalid user, has no sub'
                if (!username) throw 'username is empty'

                user = {
                    id: sub,
                    attributes: customAttributes,
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
