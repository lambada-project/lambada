import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx/classic";
import { DatabaseResultItem } from "../database";
import { SecurityResult } from "../security";

type CreateUserPoolOptions = {
    useEmailAsUsername?: boolean
    protect?: boolean
}

export default function createUserPool(poolName: string, environment: string, kmsKeys: SecurityResult, options?: CreateUserPoolOptions) {

    const name = `${poolName}-${environment}`
    const cognitoUserPool = new aws.cognito.UserPool(name, {
        name: name,
        // emailConfiguration: {

        // },

        autoVerifiedAttributes: ["email"],
        // adminCreateUserConfig: { 
        //     inviteMessageTemplate // THIS IS COOL WHEN A USER SENDS EMAIL FROM THE LANDING PAGE!!
        // }

        // schemas: [
        //     {
        //         name: "customCognitoSchemaHere",
        //         attributeDataType: 'String',
        //         required: false,
        //         mutable: true,
        //         developerOnlyAttribute: true
        //     }
        // ]
        passwordPolicy: {
            requireSymbols: false,
            minimumLength: 10,
            requireLowercase: true,
            requireNumbers: true,
            requireUppercase: true,
            temporaryPasswordValidityDays: 7
        },
        usernameConfiguration: {
            caseSensitive: false
        },
        usernameAttributes: options?.useEmailAsUsername ? ['email'] : []
    }, {
        protect: typeof options?.protect === 'undefined' ? true : options?.protect
    })

    // const main = new aws.cognito.UserPoolDomain("main", {
    //     domain: "pruebasjca01",
    //     userPoolId: cognitoUserPool.id,
    // })

    // const mobileAppClient = new aws.cognito.UserPoolClient("mobileappclient", { // TODO Name
    //     userPoolId: cognitoUserPool.id,

    //     //allowedOauthFlows: ['implicit'],
    //     //allowedOauthFlowsUserPoolClient: true,
    //     //callbackUrls: ["https://localhost", "https://website.com"],
    //     // supportedIdentityProviders: [
    //     //     "COGNITO"
    //     // ],
    //     // explicitAuthFlows: [
    //     //     "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"
    //     // ],
    //     //allowedOauthScopes: ["https://website.com/mobile.read", "openid", "profile"],
    // })

    // const resourceServer = new aws.cognito.ResourceServer("projectname", {
    //     userPoolId: cognitoUserPool.id,
    //     identifier: "https://website.com",
    //     scopes: [{
    //         scopeDescription: "User can access the mobile app",
    //         scopeName: "mobile.read",
    //     }],
    // })

    return cognitoUserPool
}