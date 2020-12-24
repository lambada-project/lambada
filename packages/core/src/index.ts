import * as pulumi from "@pulumi/pulumi";
// import * as aws from "@pulumi/aws";
// import * as awsx from "@pulumi/awsx";

import { EmbroideryApiEndpointCreator, EmbroideryEventHandlerRoute } from './api'
import createApi from './api/createApi'
import { createCloudFront } from './cdn/index'
import { EmbroideryContext } from './context'

// import createUserPool from './auth'
// import createApi from './api/createApi'
import { createMessaging, EmbroideryMessages, EmbroiderySubscriptionCreator } from './messaging'
//import createNotifications from './notifications'
import { EmbroideryTables, createDynamoDbTables } from './database'
import { CreateKMSKeys, createSecrets, EmbroideryEncryptionKeys, EmbroiderySecrets } from "./security";
import { createOpenApiDocumentEndpoint } from "./api/openApiDocument";
import { UserPool } from "@pulumi/aws/cognito/userPool";
import createUserPool from "./auth";

export * from './context'
export * from './api/index'
export * from './extra'
export * from './test_utils'
export * from './messaging'
export * from './security'

type EmbroideryRunArguments = {
    gatewayType?: 'EDGE' | 'REGIONAL' | 'PRIVATE'
    generateOpenAPIDocument?: boolean
    useCloudFront?: boolean
    endpointDefinitions?: EmbroideryApiEndpointCreator[],
    createOptionsForCors?: boolean,
    staticSiteLocalPath?: string
    tablePrefix?: string
    tables?: EmbroideryTables
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
        useCognito?: boolean | (pulumi.Input<string> | UserPool)[]
    }
}

export type EmbroideryEnvironmentVariables = pulumi.Input<{
    [key: string]: pulumi.Input<string>;
}> | undefined

export const run = (projectName: string, environment: string, args: EmbroideryRunArguments) => {

    const encryptionKeys = args.keys ? CreateKMSKeys(projectName, environment, args.keys) : {}
    const secrets = args.secrets ? createSecrets(projectName, environment, args.secrets) : {}
    const databases = args.tables ? createDynamoDbTables(environment, args.tables, args.tablePrefix, encryptionKeys) : undefined
    const pool = args.auth && args.auth.useCognito ?
        args.auth.useCognito === true ? [createUserPool(environment, encryptionKeys)] : args.auth.useCognito
        : undefined
    const messaging = args.messages ? createMessaging(environment, args.messages, databases, /*encryptionKeys*/ undefined) : undefined
    // const notifications = createNotifications(environment)

    const stageName = 'app'
    const wwwPath = '/www'
    const apiPath = '/api'

    if (args.generateOpenAPIDocument && args.endpointDefinitions) {
        args.endpointDefinitions.push(createOpenApiDocumentEndpoint)
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
            path: wwwPath
        } : undefined,
        databases: databases,
        environmentVariables: args.environmentVariables || {},
        secrets: secrets,
        authorizerProviderARNs: pool,
        kmsKeys: encryptionKeys,
        messaging: messaging
    })


    const getDomain = (x: string) => x.substr(8, x.indexOf('.com') - 8 + 4)

    const cdn = args.useCloudFront ? createCloudFront(
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
        }
    ) : undefined

    return {
        api: api,
        cdn: cdn
    }
}