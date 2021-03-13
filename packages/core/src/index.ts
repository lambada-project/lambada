import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

import { EmbroideryApiEndpointCreator, EmbroideryEventHandlerRoute, LambadaEndpointCreator } from './api'
import createApi from './api/createApi'
import { createCloudFront } from './cdn/index'
import { LambadaResources } from './context'

// import createUserPool from './auth'
// import createApi from './api/createApi'
import { createMessaging, EmbroideryMessages, EmbroiderySubscriptionCreator } from './messaging'
//import createNotifications from './notifications'
import { EmbroideryTables, createDynamoDbTables } from './database'
import { CreateKMSKeys, createSecrets, EmbroideryEncryptionKeys, EmbroiderySecrets } from "./security";
import { createOpenApiDocumentEndpoint } from "./api/openApiDocument";
import { UserPool } from "@pulumi/aws/cognito/userPool";
import createUserPool from "./auth";
import { CognitoAuthorizer } from "@pulumi/awsx/apigateway";

export * from './context'
export * from './api/index'
export * from './extra'
export * from './test_utils'
export * from './messaging'
export * from './security'

type EmbroideryRunArguments = {
    gatewayType?: 'EDGE' | 'REGIONAL' | 'PRIVATE'
    generateOpenAPIDocument?: boolean
    cdn?: {
        useCDN: boolean,
        customDomain?: string[]
    },
    endpointDefinitions?: (EmbroideryApiEndpointCreator | LambadaEndpointCreator)[],
    createOptionsForCors?: boolean,
    staticSiteLocalPath?: string
    tablePrefix?: string
    /** Tables to create */
    tables?: EmbroideryTables
    /** Referenced tables, does not create anything */
    tablesRef?: EmbroideryTables
    messages?: EmbroideryMessages,
    messageHandlerDefinitions?: EmbroiderySubscriptionCreator[],
    environmentVariables?: EmbroideryEnvironmentVariables,
    secrets?: EmbroiderySecrets
    keys?: EmbroideryEncryptionKeys
    naming?: { // TODO: Should I do this? or not
        apiPath?: string
        wwwPath?: string
        stageName?: string
    },
    auth?: {
        useCognito?: boolean | pulumi.Input<string> | UserPool
        cognitoOptions?: {
            useEmailAsUsername? : boolean
            preventResourceDeletion: boolean
        }
    }
}

export type EmbroideryEnvironmentVariables = pulumi.Input<{
    [key: string]: pulumi.Input<string>;
}> | undefined

export const run = (projectName: string, environment: string, args: EmbroideryRunArguments) => {

    const encryptionKeys = args.keys ? CreateKMSKeys(projectName, environment, args.keys) : {}
    const secrets = args.secrets ? createSecrets(projectName, environment, args.secrets) : {}
    const databases = args.tables ? createDynamoDbTables(environment, args.tables, args.tablePrefix, encryptionKeys, args.tablesRef) : undefined
    
    const pool: pulumi.Input<string> | UserPool | undefined = args.auth && args.auth.useCognito ?
        args.auth.useCognito === true ? createUserPool(projectName, environment, encryptionKeys, {
            useEmailAsUsername: args?.auth?.cognitoOptions?.useEmailAsUsername,
            protect: args?.auth?.cognitoOptions?.preventResourceDeletion
        }) : args.auth.useCognito
        : undefined

    const isPool = (userPool: pulumi.Input<string> | UserPool | undefined): userPool is UserPool => {
        return typeof userPool !== 'undefined' && (userPool as UserPool).arn !== undefined
    }

    const cognitoARN = isPool(pool) ? pool.arn : pool
    const cognitoPoolId = isPool(pool) ? pool.id : undefined


    const messaging = args.messages ? createMessaging(environment, args.messages, args.messageHandlerDefinitions) : undefined
    // const notifications = createNotifications(environment)

    const stageName = 'app'
    const wwwPath = '/www'
    const apiPath = '/api'

    if (args.generateOpenAPIDocument && args.endpointDefinitions) {
        args.endpointDefinitions.push(createOpenApiDocumentEndpoint)
    }


    const authorizerProviderARNs = pool ? [pool] : undefined
    const authorizers: CognitoAuthorizer[] = [
        ...(authorizerProviderARNs ? [awsx.apigateway.getCognitoAuthorizer({
            providerARNs: authorizerProviderARNs,
            //methodsToAuthorize: ["https://yourdomain.com/user.read"]
        })] : []),
    ];

    // TODO: option to add projectName as prefix to all functions
    const embroideryContext: LambadaResources = {
        projectName: projectName,
        api: apiPath ? {
            apiPath: apiPath
        } : undefined,
        authorizers: authorizers,
        messaging: messaging,
        //notifications: notifications, // TODO: 
        databases: databases,
        environment: environment,
        kmsKeys: encryptionKeys,
        environmentVariables: args.environmentVariables || {},
        secrets: secrets
    }

    // TODO: Move to file
    if (args.messageHandlerDefinitions) {
        for (const handler of args.messageHandlerDefinitions) {
            handler(embroideryContext)
        }
    }

    //TODO pass stage name as parameter
    const api = createApi({
        projectName,
        environment,
        api: args.endpointDefinitions ? {
            path: apiPath,
            apiEndpoints: args.endpointDefinitions || [],
            type: args.gatewayType || 'EDGE',
            createOptionsForCors: args.createOptionsForCors
        } : undefined,
        www: args.staticSiteLocalPath ? {
            local: args.staticSiteLocalPath,
            path: wwwPath,
        } : undefined,
        context: embroideryContext
        // databases: databases,
        // environmentVariables: args.environmentVariables || {},
        // secrets: secrets,
        // authorizerProviderARNs: pool ? [pool] : undefined,
        // kmsKeys: encryptionKeys,
        // messaging: messaging
    })


    const getDomain = (x: string) => x.substr(8, x.indexOf('.com') - 8 + 4)

    const cdn = args.cdn && args.cdn.useCDN ? createCloudFront(
        projectName,
        environment,
        {
            pattern: apiPath, // internally we add /* 
            domain: api.url.apply(x => getDomain(x)),
            path: `/${stageName}`
        },
        {
            domain: api.url.apply(x => getDomain(x)),
            path: `/${stageName}${wwwPath}`
        },
        args.cdn.customDomain
    ) : undefined

    return {
        api: api,
        cdn: cdn,
        auth: {
            cognitoARN: cognitoARN,
            cognitoPoolId: cognitoPoolId
        }
    }
}