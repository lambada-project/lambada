import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx/classic";
import * as aws from "@pulumi/aws";

import createApi, { LambadaCreator } from './api/createApi'
import { createCloudFront } from './cdn/index'
import { LambadaResources } from './context'

// import createUserPool from './auth'
// import createApi from './api/createApi'
import { createMessaging, LambadaMessages, LambadaSubscriptionCreator, MessagingResult } from './messaging'
import createNotifications, { NotificationConfig } from './notifications'
import { DatabaseResult, EmbroideryTables, createDynamoDbTables } from './database'
import { CreateKMSKeys, createSecrets, EmbroideryEncryptionKeys, EmbroiderySecrets } from "./security";
import { UserPool } from "@pulumi/aws/cognito/userPool";
import createUserPool from "./auth";
import { CognitoAuthorizer } from "@pulumi/awsx/classic/apigateway";
import { createQueues, LambadaQueues, LambadaQueueSubscriptionCreator, QueuesResult } from "./queue";
import { createQueueHandler } from "./queue/createQueueHandler";
import { OpenAPIObjectConfigV31 } from "@asteasolutions/zod-to-openapi/dist/v3.1/openapi-generator";
import { FunctionVpcConfig, LambdaOptions } from "./lambdas";

export * from './context'
export * from './api/index'
export * from './extra'
export * from './test_utils'
export * from './messaging'
export * from './security'

type LambadaRunArguments = {
    api?: {
        endpointDefinitions?: LambadaCreator[],
        gatewayType?: 'EDGE' | 'REGIONAL' | 'PRIVATE'
        vpcEndpointIds?: pulumi.Input<pulumi.Input<string>[]> | undefined,
        
        policy?: pulumi.Input<string> | undefined,
        openAPIDocument?: OpenAPIObjectConfigV31
        lambdaDefaultOptions?:  LambdaOptions
    },
    cdn?: {
        useCDN: boolean,
        customDomain?: {
            domainWithCert: string
            aliases: string[]
        }
        isSpa: boolean
        /** Overrides default: index.html. Errors are redirected here, useful for spa */
        entrypoint?: string
    },
    cors?: {
        origins: string[]
    },
    staticSiteLocalPath?: string

    tablePrefix?: string
    /** Tables to create */
    tables?: EmbroideryTables
    /** Referenced tables, does not create anything */
    tablesRef?: EmbroideryTables | DatabaseResult

    /** Topics to create */
    messages?: LambadaMessages,
    /** Referenced topics, does not create anything */
    messagesRef?: LambadaMessages | MessagingResult
    messageHandlerDefinitions?: LambadaSubscriptionCreator[],

    queues?: LambadaQueues,
    queuesRef?: LambadaQueues | QueuesResult,
    queueHandlerDefinitions?: LambadaQueueSubscriptionCreator[]

    environmentVariables?: EmbroideryEnvironmentVariables,
    secrets?: EmbroiderySecrets
    keys?: EmbroideryEncryptionKeys
    notifications?: NotificationConfig
    naming?: { // TODO: Should I do this? or not
        apiPath?: string
        wwwPath?: string
        stageName?: string
    },
    auth?: {
        createCognito?: boolean
        extraAuthorizers: (pulumi.Input<string> | UserPool)[],
        cognitoOptions?: {
            useEmailAsUsername?: boolean
            preventResourceDeletion: boolean
        },
        useApiKey?: {
            name?: string
            openapi?: {
                description: string
            }
        }
    },
    resourceGroups?: {
        /** 
         * Does not create a resource group 
         * */
        skipCreate?: boolean
        /** 
         * Overrides the default name (projectName-environment)
         */
        name?: string
    },
    options?: {
        dependsOn: pulumi.Input<pulumi.Resource> | pulumi.Input<pulumi.Input<pulumi.Resource>[]> | undefined;
    }
}

export type EmbroideryEnvironmentVariables = pulumi.Input<{
    [key: string]: pulumi.Input<string>;
}> | undefined

export const run = (projectName: string, environment: string, args: LambadaRunArguments) => {
    const globalTags = {
        "Lambada:Project": projectName,
        "Lambada:Environment": environment
    }

    const encryptionKeys = args.keys ? CreateKMSKeys(projectName, environment, args.keys) : {}
    const secrets = args.secrets ? createSecrets(projectName, environment, args.secrets) : {}
    const databases = createDynamoDbTables(environment, args.tables, args.tablePrefix, encryptionKeys, args.tablesRef, globalTags)

    const pool: UserPool | undefined = args.auth && args.auth.createCognito ?
        createUserPool(projectName, environment, encryptionKeys, {
            useEmailAsUsername: args?.auth?.cognitoOptions?.useEmailAsUsername,
            protect: args?.auth?.cognitoOptions?.preventResourceDeletion
        }) : undefined

    const isPool = (userPool: pulumi.Input<string> | UserPool | undefined): userPool is UserPool => {
        return typeof userPool !== 'undefined' && (userPool as UserPool).arn !== undefined
    }

    const cognitoARN = isPool(pool) ? pool.arn : pool
    const cognitoPoolId = isPool(pool) ? pool.id : undefined


    const messaging = createMessaging(environment, args.messages, args.messagesRef, globalTags)
    const queues = createQueues(environment, args.queues, args.queuesRef)
    const notifications = createNotifications(projectName, environment, args?.notifications)

    const stageName = args.naming?.stageName ?? 'app'
    const wwwPath = args.naming?.wwwPath ?? '/www'
    const apiPath = args.naming?.apiPath ?? '/api'

    const authorizerProviderARNs = pool ? [pool, ...(args.auth?.extraAuthorizers ?? [])] : (args.auth?.extraAuthorizers ?? [])
    const authorizer = awsx.apigateway.getCognitoAuthorizer({
        providerARNs: authorizerProviderARNs,
        //methodsToAuthorize: ["https://yourdomain.com/user.read"]
    })
    const authorizers: CognitoAuthorizer[] = authorizerProviderARNs.length > 0 ? [authorizer] : [];



    // TODO: option to add projectName as prefix to all functions
    const lambadaContext: LambadaResources = {
        projectName: projectName,
        api: apiPath ? {
            apiPath: apiPath,
            cors: args.cors,
            auth: {
                useApiKey: typeof args.auth?.useApiKey != 'undefined',
                useCognitoAuthorizer: !!args.auth?.createCognito || !!args.auth?.extraAuthorizers?.length
            },
            lambdaOptions: args.api?.lambdaDefaultOptions
        } : undefined,
        authorizers: authorizers,
        messaging: messaging,
        queues: queues,
        notifications: notifications, // TODO: 
        databases: databases,
        environment: environment,
        kmsKeys: encryptionKeys,
        environmentVariables: args.environmentVariables || {},
        secrets: secrets,
        globalTags: globalTags
    }

    if (args.messageHandlerDefinitions) {
        for (const handler of args.messageHandlerDefinitions) {
            handler(lambadaContext)
        }
    }

    if (args.queueHandlerDefinitions) {
        for (const handler of args.queueHandlerDefinitions) {
            createQueueHandler(lambadaContext, handler(lambadaContext))
        }
    }

    //TODO pass stage name as parameter
    const api = createApi({
        projectName,
        environment,
        api: args.api?.endpointDefinitions ? {
            path: apiPath,
            apiEndpoints: args.api.endpointDefinitions || [],
            type: args.api.gatewayType || 'EDGE',
            cors: args.cors,
            vpcEndpointIds: args.api.vpcEndpointIds,
            policy: args.api.policy,
            openApiSpec: args.api.openAPIDocument,
        } : undefined,
        www: args.staticSiteLocalPath ? {
            local: args.staticSiteLocalPath,
            path: wwwPath,
        } : undefined,
        context: lambadaContext,
        auth: {
            apiKey: args.auth?.useApiKey
        },
        options: args.options,

    })

    let apiKey: awsx.apigateway.AssociatedAPIKeys | undefined = undefined

    if (api && args.auth?.useApiKey) {
        apiKey = awsx.apigateway.createAssociatedAPIKeys(`${projectName}-api-keys-${environment}`, {
            apis: [api],
            apiKeys: [{
                name: args.auth.useApiKey?.name ?? "internal-key",
            }],
        })
    }


    const getDomain = (x: string) => x.substr(8, x.indexOf('.com') - 8 + 4)

    const cdn = api && args.cdn && args.cdn.useCDN ? createCloudFront(
        projectName,
        environment,
        {
            pattern: apiPath, // internally we add /* 
            domain: api.url.apply(x => getDomain(x)),
            path: `/${stageName}`
        },
        {
            domain: api.url.apply(x => getDomain(x)),
            path: `/${stageName}${wwwPath}`,
            spa: args.cdn.isSpa ? {
                notFoundRedirection: true,
                entrypoint: args.cdn.entrypoint
            } : undefined
        },
        args.cdn.customDomain,
    ) : undefined


    if (!args.resourceGroups?.skipCreate) {
        const groupName = args.resourceGroups?.name ?? `${projectName}-${environment}`

        new aws.resourcegroups.Group(groupName, {
            name: groupName,
            resourceQuery: {
                query: JSON.stringify({
                    ResourceTypeFilters: ["AWS::AllSupported"],
                    TagFilters: [{
                        "Key": "Lambada:Project",
                        "Values": [projectName]
                    }, {
                        "Key": "Lambada:Environment",
                        "Values": [environment]
                    }]
                }),
                type: "TAG_FILTERS_1_0"
            }
        })
    }

    return {
        api: api,
        cdn: cdn,
        auth: {
            cognitoARN: cognitoARN,
            cognitoPoolId: cognitoPoolId
        },
        messaging: messaging,
        queues: queues,
        databases: databases,
        apiKey: apiKey,
        secrets: secrets,
        security: encryptionKeys
    }
}