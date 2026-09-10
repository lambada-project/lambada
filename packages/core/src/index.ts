import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx/classic";
import * as aws from "@pulumi/aws";

import createApi, { LambadaEndpoint } from './api/createApi'
import { OpenApiFactoryLike } from './api/createEndpoint'
import { createCloudFront } from './cdn/index'
import { LambadaResources } from './context'

// import createUserPool from './auth'
// import createApi from './api/createApi'
import { createMessaging, createSubscriptions, LambadaMessages, LambadaSubscriptionDefinition, MessagingResult } from './messaging'
import createNotifications, { NotificationConfig } from './notifications'
import { DatabaseResult, LambadaTables, TableOptions, createDynamoDbTables } from './database'
import { createKMSKeys, createSecrets, SecurityKeys, SecurityKeysRef, EmbroiderySecrets, SecretsResult, SecurityResult } from "./security";
import { UserPool } from "@pulumi/aws/cognito/userPool";
import { LambdaAuthorizer } from "@pulumi/awsx/classic/apigateway";
import { createQueueHandlers, createQueues, LambadaQueueHandlerDefinition, LambadaQueues, QueuesResult } from "./queue";
import { OpenAPIObjectConfigV31 } from "@asteasolutions/zod-to-openapi/dist/v3.1/openapi-generator";
import { LambdaOptions } from "./lambdas";
import { BundleSource } from "./lambdas/bundles";
import { createPools, LambadaPools, LambadaPoolsRef, PoolsResult } from "./auth/pools";
import { createDiagnostics } from "./resources/diagnostics";
import { preflight } from "./resources/preflight";

export * from './context'
export * from './inputs'
// A pre-built bundle to deploy in place of a serialized closure; see `useBundle` on an endpoint.
export type { LambdaFolder } from './lambdas'
export * from './lambdas/bundles'
export * from './api/index'
export * from './extra'
export * from './test_utils'
export * from './messaging'
export * from './queue'
export * from './auth/pools'
export * from './resources'
export * from './security'

export type LambadaRunArguments = {
    api?: {
        // Constrained per element, not inferred for the list: one type would bind to the first
        // endpoint and demand the rest match, which specs differing per operation never do.
        endpointDefinitions?: readonly LambadaEndpoint<OpenApiFactoryLike | undefined>[],
        gatewayType?: 'EDGE' | 'REGIONAL' | 'PRIVATE'
        vpcEndpointIds?: pulumi.Input<pulumi.Input<string>[]> | undefined,

        policy?: pulumi.Input<string> | undefined,
        openAPIDocument?: OpenAPIObjectConfigV31
        lambdaDefaultOptions?: LambdaOptions
        stage?: {
            name?: string
            variables?: Record<string, pulumi.Input<string>>
        }
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
        headers: string[]
    },
    staticSiteLocalPath?: string

    /** Prefixes every table this stack creates. A ref elsewhere spells it: `${prefix}-${name}`. */
    tablePrefix?: string
    /** Tables to create */
    tables?: LambadaTables
    /** Referenced tables, does not create anything */
    tablesRef?: LambadaTables | DatabaseResult
    /** Global Table Options. Changes defaults of all tables */
    tableOptions?: TableOptions

    /** Topics to create */
    messages?: LambadaMessages,
    /** Referenced topics, does not create anything */
    messagesRef?: LambadaMessages | MessagingResult
    messageHandlerDefinitions?: readonly LambadaSubscriptionDefinition[],

    queues?: LambadaQueues,
    queuesRef?: LambadaQueues | QueuesResult,
    queueHandlerDefinitions?: readonly LambadaQueueHandlerDefinition[]

    /**
     * Pre-built artifacts by function name, for a definition carrying no `useBundle` of its own.
     * Endpoints, subscriptions and queue handlers; not webhooks, whose queue lambda is lambada's
     * glue rather than the declaration's callback.
     */
    bundles?: BundleSource

    /**
     * Values a function receives only by declaring them under `resources.envVar`. A function sees
     * what it asks for and nothing else in here.
     */
    environmentVariables?: EmbroideryEnvironmentVariables,
    globalEnvironmentVariables?: EmbroideryEnvironmentVariables,
    /** Cognito pools this stack creates */
    pools?: LambadaPools,
    /** Referenced cognito pools, does not create anything */
    poolsRef?: LambadaPoolsRef | PoolsResult
    secrets?: EmbroiderySecrets
    /** Referenced secrets, does not create anything */
    secretsRef?: SecretsResult | EmbroiderySecrets
    keys?: SecurityKeys
    /** Referenced keys, does not create anything */
    keysRef?: SecurityKeysRef | SecurityResult
    notifications?: NotificationConfig
    naming?: { // TODO: Should I do this? or not
        apiPath?: string
        wwwPath?: string
        stageName?: string
    },
    auth?: {
        createCognito?: boolean
        /** Lambda authorizers for the API. Cognito pools are picked by `authorizerPools`. */
        lambdaAuthorizers?: LambdaAuthorizer[],
        /**
         * Which pools the API accepts tokens from, by the name each is declared under in `pools` or
         * `poolsRef`. The one `createCognito` builds is always included.
         */
        authorizerPools?: readonly string[],
        /**
         * @deprecated Two unrelated kinds in one list. Declare a lambda authorizer under
         * `lambdaAuthorizers`, and a cognito pool by naming it in `authorizerPools`.
         */
        extraAuthorizers?: (pulumi.Input<string> | UserPool | LambdaAuthorizer)[],
        cognitoOptions?: {
            useEmailAsUsername?: boolean
            preventResourceDeletion: boolean
            /** What `resources.pool` grants the created pool by. Defaults to `userPool`. */
            key?: string
            /** Published to every function granted it. Defaults to `COGNITO_USER_POOL_ID`. */
            envKeyName?: string
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

    const diagnostics = createDiagnostics()

    const encryptionKeys = createKMSKeys(projectName, environment, args.keys, args.keysRef)
    const secrets = createSecrets(projectName, environment, args.secrets, args.secretsRef)
    const databases = createDynamoDbTables(environment, args.tables, args.tablePrefix, encryptionKeys, args.tablesRef, globalTags)

    const { pools, authorizers: poolProviders, auth: cognito } = createPools(
        projectName, environment, encryptionKeys, args.auth, args.pools, args.poolsRef
    )

    const messaging = createMessaging(environment, args.messages, args.messagesRef, globalTags)
    const queues = createQueues(environment, args.queues, args.queuesRef)
    const notifications = createNotifications(projectName, environment, args?.notifications)

    const stageName = args.naming?.stageName ?? 'app'
    const wwwPath = args.naming?.wwwPath ?? '/www'
    const apiPath = args.naming?.apiPath ?? '/api'


    type ExtraAuthorizer = pulumi.Input<string> | UserPool | LambdaAuthorizer

    const isLambdaAuthorizer = (x: ExtraAuthorizer): x is LambdaAuthorizer =>
        typeof x === 'object' && x !== null && 'parameterLocation' in x && 'handler' in x

    // The deprecated list holds one kind or the other, so what is not a lambda authorizer is what a
    // cognito authorizer takes. The predicate says that, rather than claiming every one is a pool.
    const isCognitoProvider = (x: ExtraAuthorizer): x is pulumi.Input<string> | UserPool =>
        !isLambdaAuthorizer(x)

    const extra: ExtraAuthorizer[] = args.auth?.extraAuthorizers ?? []
    const lambdaAuthorizers = [...(args.auth?.lambdaAuthorizers ?? []), ...extra.filter(isLambdaAuthorizer)]
    const allUserPools = [...poolProviders, ...extra.filter(isCognitoProvider)]

    const cognitoAuthorizer = allUserPools.length > 0 ?  awsx.apigateway.getCognitoAuthorizer({
        providerARNs: allUserPools,
    }) : undefined

    const authorizers = [...(cognitoAuthorizer ? [cognitoAuthorizer] : []), ...lambdaAuthorizers]



    // TODO: option to add projectName as prefix to all functions
    const lambadaContext: LambadaResources = {
        projectName: projectName,
        api: apiPath ? {
            apiPath: apiPath,
            cors: args.cors,
            auth: {
                useApiKey: typeof args.auth?.useApiKey != 'undefined',
                useAuthorizers: authorizers.length > 0
            },
            lambdaOptions: args.api?.lambdaDefaultOptions
        } : undefined,
        authorizers: authorizers,
        messaging: messaging,
        queues: queues,
        notifications: notifications,
        databases: databases,
        environment: environment,
        kmsKeys: encryptionKeys,
        environmentVariables: args.environmentVariables || {},
        globalEnvironmentVariables: args.globalEnvironmentVariables || {},
        diagnostics: diagnostics,
        secrets: secrets,
        pools: pools,
        globalTags: globalTags,
        bundles: args.bundles
    }

    // Every name a plain declaration uses is checked before anything is built, so a stack with
    // several bad names fails once naming all of them, not once per deploy.
    preflight(lambadaContext, diagnostics, [
        args.messageHandlerDefinitions,
        args.queueHandlerDefinitions,
        args.api?.endpointDefinitions,
    ])

    createSubscriptions(lambadaContext, args.messageHandlerDefinitions)
    createQueueHandlers(lambadaContext, args.queueHandlerDefinitions)

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
        stage: args.api?.stage,
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
        auth: cognito,
        messaging: messaging,
        queues: queues,
        pools: pools,
        databases: databases,
        apiKey: apiKey,
        secrets: secrets,
        security: encryptionKeys
    }
}