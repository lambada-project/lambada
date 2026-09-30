import * as pulumi from '@pulumi/pulumi'
import * as aws from "@pulumi/aws";
import { Callback, Runtime } from '@pulumi/aws/lambda';
import { Input } from "@pulumi/pulumi";

import { PolicyDocument, PolicyStatement } from "@pulumi/aws/iam";
import { DatabaseResultItem } from '../database';
//import { MessagingResultItem } from '../messaging';
import { SecretResultItem, SecurityResultItem } from '../security';
import { MessagingResultItem } from '../messaging';
import { NotificationResult } from '../notifications';
import { EmbroideryEnvironmentVariables } from '..';
import { enums } from '@pulumi/aws/types';
import { QueueResultItem } from '../queue';
import { BucketResultItem } from '../buckets';
import { lift } from '../inputs';
import { PoolResultItem } from '../auth/pools';
//import { NotificationResult, NotificationResultItem } from '../notifications';

export const lambdaAssumeRole: PolicyDocument = {
    Version: "2012-10-17",
    Statement: [
        {
            Action: ["sts:AssumeRole"],
            Principal: {
                Service: "lambda.amazonaws.com"
            },
            Effect: "Allow",
        }
    ]
}

export const logsStatement: PolicyStatement = {
    Effect: "Allow",
    "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
    ],
    "Resource": "arn:aws:logs:*:*:*"
};

const VPCAccessExecutionStatement: PolicyStatement = {
    "Effect": "Allow",
    "Action": [
        "ec2:DescribeNetworkInterfaces",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeInstances",
        "ec2:AttachNetworkInterface"
    ],
    "Resource": "*"
}

//AWSXRayDaemonWriteAccess 
const AWSXRayDaemonWriteAccess: PolicyStatement = {
    "Effect": "Allow",
    "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries"
    ],
    "Resource": "*"
}


export type LambdaFolder = {
    /**
     * Handler directory location
     */
    functionFolder: string
    /**
     * File.Export
     */
    handler: string
}

export type LambdaOptions = {
    /**
    * Amount of memory in MB your Lambda Function can use at runtime. Defaults to `128`. See [Limits](https://docs.aws.amazon.com/lambda/latest/dg/limits.html)
    */
    memorySize?: number

    /**
     *  Timeout in minutes 
     * */
    timeout?: pulumi.Input<number>

    /**
     * Runtime as per AWS documentation
     */
    runtime?: Runtime

    /**
     * OS Runtime Architecture as per AWS documentation
     */
    architecture?: "x8664" | "arm64"

    /**
     * The amount of reserved concurrent executions for this lambda function. A value of `0` disables lambda from being triggered and `-1` removes any concurrency limitations. Defaults to Unreserved Concurrency Limits `-1`. See [Managing Concurrency](https://docs.aws.amazon.com/lambda/latest/dg/concurrent-executions.html) 
     * */
    reservedConcurrentExecutions?: number

    /**
     * VPC configuration associated with your Lambda function. See [VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
     * */
    vpcConfig?: Input<FunctionVpcConfig>

    /**
     * Set to false to send the response right away and not wait for the event loop to be empty
     */
    callbackWaitsForEmptyEventLoop?: boolean

    /**
     * Layers to add to the lambda
     */
    //layers?: aws.lambda.LayerVersion[]
    layers?: pulumi.Input<pulumi.Input<string>[]> | undefined

    /**
     * Enables XRay access from this lambda
     */
    enableXRay?: pulumi.Input<boolean>
}

/** What one granted resource costs in IAM and in environment. */
export const resourceStatements = (
    access: LambdaResource,
    functionName: string,
    environment: string
): { statements: aws.iam.PolicyStatement[], envVars: Record<string, pulumi.Input<string>> } => {
    if (access.access.length === 0) {
        throw new Error(`Resource on ${functionName} has zero access request`)
    }
    const { resource, envVars } = grantedResource(access, functionName, environment)

    return { statements: [{ Action: access.access, Resource: resource, Effect: 'Allow' }], envVars }
}

const grantedResource = (
    access: LambdaResource,
    functionName: string,
    environment: string
): { resource: aws.iam.PolicyStatement['Resource'], envVars: Record<string, pulumi.Input<string>> } => {
    if (access.table) {
        const { table } = access
        // IAM applies each action only to the resource types it supports.
        const arns: pulumi.Input<string>[] = [table.ref.arn]
        if (table.definition.indexes?.length && access.access.some(onIndex))
            arns.push(pulumi.interpolate`${table.ref.arn}/index/*`)
        if (table.streamEnabled && access.access.some(onStream))
            arns.push(table.ref.streamArn)

        return { resource: arns, envVars: { [table.definition.envKeyName]: table.ref.name } }
    }
    if (access.bucket) {
        // S3 calls address a bucket by name, and object actions are on `${arn}/*`, not the bucket.
        const { awsS3Bucket, envKeyName } = access.bucket
        return { resource: [awsS3Bucket.arn, pulumi.interpolate`${awsS3Bucket.arn}/*`], envVars: { [envKeyName]: awsS3Bucket.bucket } }
    }
    if (access.topic) {
        //PubSub connections need the topic ARN to talk to SNS
        return { resource: access.topic.ref.arn, envVars: { [access.topic.envKeyName]: access.topic.ref.arn } }
    }
    if (access.queue) {
        const { queue } = access
        return { resource: queue.ref.arn, envVars: { [queue.envKeyName]: queue.ref.url ?? queue.awsQueue.url } }
    }
    if (access.notification) {
        if (!access.notification.gcm) throw new Error('other notification system than GCM is not implemented')
        return { resource: access.notification.gcm.application.arn, envVars: {} }
    }
    if (access.secret) {
        // A secretsmanager call addresses a secret by name; the policy needs its ARN.
        const { secret } = access
        return { resource: secret.awsSecret.arn, envVars: { [secret.definition.envKeyName]: secret.awsSecret.name } }
    }
    if (access.kmsKey) {
        const { definition, awsKmsKey } = access.kmsKey
        return { resource: awsKmsKey.arn, envVars: definition ? { [definition.envKeyName]: awsKmsKey.arn } : {} }
    }
    if (access.pool) {
        //Cognito calls need the pool id to address the pool
        return { resource: access.pool.ref.arn, envVars: { [access.pool.envKeyName]: access.pool.ref.id } }
    }
    if (access.arn) {
        return { resource: access.arn, envVars: {} }
    }
    throw functionName + '-' + environment + ': Access must have the resource, eg. topic, table, messaging, etc. ' + JSON.stringify(access);
}

export const createLambda = <E, R>(
    name: string,
    environment: string,
    definition: Callback<E, R> | LambdaFolder,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables,
    resources: LambdaResource[],
    overrideRole?: aws.iam.Role,
    options?: LambdaOptions,
    description?: string,
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>
): aws.lambda.EventHandler<E, R> => {

    if (!policyStatements) policyStatements = []
    if (!environmentVariables) environmentVariables = {}

    const granted = [...policyStatements]

    var envVarsFromResources: EmbroideryEnvironmentVariables = {}
    for (let i = 0; i < resources.length; i++) {
        const resolved = resourceStatements(resources[i], name, environment)

        granted.push(...resolved.statements)
        Object.assign(envVarsFromResources, resolved.envVars)
    }

    if (options?.vpcConfig) {
        granted.push(VPCAccessExecutionStatement)
    }

    // enableXRay may be an Input, and an Input tested directly is an object: `false` would read as
    // true. The statement is added where the value is known, so the document becomes an Output.
    const statements = lift(options?.enableXRay ?? false, enabled =>
        enabled ? [...granted, AWSXRayDaemonWriteAccess] : granted)

    const roleArn = overrideRole?.arn ??
        roleFor(name, environment, statements, grantsKey(environment, policyStatements, resources, options))

    const variables = {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        ...envVarsFromResources,
        ...environmentVariables
    }

    //NOTE: for some reason, it cannot be a empty object, so we need to see how many keys the object has, if zero then pass undefined
    const hasKeys = Object.keys(variables).length > 0
    const functionEnvironment = hasKeys ? {
        variables
    } : undefined

    // TODO: This should be exposed per lambda and as global defaults
    const memorySize = options?.memorySize ?? 512
    const timeout = options?.timeout ?? 90
    const reservedConcurrentExecutions = options?.reservedConcurrentExecutions ?? -1
    const runtime = options?.runtime ?? aws.lambda.Runtime.NodeJS22dX
    const architectures = options?.architecture ? [options?.architecture] : undefined
    const layers = options?.layers

    const _vpcConfig = options?.vpcConfig ?? {
        securityGroupIds: [],
        subnetIds: []
    }

    description = description ?? `${name}-${environment}`

    if (typeof definition === 'function') {
        const callbackDefinition = definition as Callback<E, R>
        return new aws.lambda.CallbackFunction(`${name}-${environment}`, {
            callback: callbackDefinition,
            role: roleArn,
            description: description,
            environment: functionEnvironment,
            memorySize: memorySize,
            timeout: timeout,
            reservedConcurrentExecutions: reservedConcurrentExecutions,
            runtime: runtime,
            architectures: architectures,
            vpcConfig: _vpcConfig,
            tags: tags,
            layers: layers
        })
    }
    else if ((definition as LambdaFolder).functionFolder) {
        const handlerInfo = (definition as LambdaFolder)

        return new aws.lambda.Function(`${name}-${environment}`, {
            runtime: runtime,
            architectures: architectures,
            description: description,
            code: new pulumi.asset.AssetArchive({
                ".": new pulumi.asset.FileArchive(
                    handlerInfo.functionFolder
                    //`./auth/lambdas/src/dist`
                ),
            }),
            memorySize: memorySize,
            //code: new pulumi.asset.FileAsset('./auth/lambdas/postConfirmation.js'),
            timeout: timeout,
            //THE CONTENT OF DIST 1:1 
            handler: handlerInfo.handler, //"./auth/lambdas/src/index.main",
            role: roleArn,
            layers: layers,
            environment: functionEnvironment, // TODO:
            reservedConcurrentExecutions: reservedConcurrentExecutions,
            vpcConfig: _vpcConfig,
            tags: tags
        });
    }
    else {
        pulumi.log.error(`Invalid lambda definition: ${JSON.stringify(definition)}`)
        throw Error('Invalid lambda definition. I can only be a callback or te location of the folder to deploy')
    }
}

type ResolvedStatement = pulumi.Unwrap<aws.iam.PolicyStatement>

const canonical = <T>(value: T): T =>
    Array.isArray(value) ? value.map(canonical).sort() as T
        : value !== null && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as any)[k])])) as T
            : value

/** IAM ignores case in action names. */
const actionName = (action: string) => action.toLowerCase()

const lowerActions = (s: ResolvedStatement): ResolvedStatement => ({
    ...s,
    ...(s.Action !== undefined && { Action: [s.Action].flat().map(actionName) }),
    ...(s.NotAction !== undefined && { NotAction: [s.NotAction].flat().map(actionName) }),
})

const withResources = (statement: ResolvedStatement, resources: Iterable<string>): ResolvedStatement => {
    const list = [...resources]
    return canonical(list.length === 0 ? statement : { ...statement, Resource: list.length === 1 ? list[0] : list })
}

export const mergeStatements = (statements: ResolvedStatement[]): ResolvedStatement[] => {
    const grantsByContext = new Map<string, { context: ResolvedStatement, actionsByResource: Map<string, Set<string>> }>()
    const unpaired = new Map<string, { statement: ResolvedStatement, resources: Set<string> }>()

    for (const s of statements) {
        const { Action, Resource, ...context } = canonical(lowerActions(s))

        if (Action !== undefined && Resource !== undefined) {
            const key = JSON.stringify(context)
            const group = grantsByContext.get(key) ?? { context, actionsByResource: new Map() }
            for (const resource of [Resource].flat()) {
                const actions = group.actionsByResource.get(resource) ?? new Set()
                for (const action of [Action].flat()) actions.add(action)
                group.actionsByResource.set(resource, actions)
            }
            grantsByContext.set(key, group)
        } else {
            // NotAction and NotResource do not state (action, resource) pairs.
            const statement = canonical({ ...context, ...(Action !== undefined && { Action }) })
            const key = JSON.stringify(statement)
            const group = unpaired.get(key) ?? { statement, resources: new Set() }
            for (const resource of [Resource ?? []].flat()) group.resources.add(resource)
            unpaired.set(key, group)
        }
    }

    const merged = [...unpaired.values()].map(({ statement, resources }) => withResources(statement, resources))

    for (const { context, actionsByResource } of grantsByContext.values()) {
        const byActions = new Map<string, { Action: string[], resources: string[] }>()
        for (const [resource, set] of actionsByResource) {
            const Action = canonical([...set])
            const key = JSON.stringify(Action)
            const group = byActions.get(key) ?? { Action, resources: [] }
            group.resources.push(resource)
            byActions.set(key, group)
        }
        for (const { Action, resources } of byActions.values()) merged.push(withResources({ ...context, Action }, resources))
    }

    return merged.map(s => [JSON.stringify(s), s] as const).sort(([a], [b]) => a < b ? -1 : 1).map(([, s]) => s)
}

const sharedRoles = new Map<string, { role: aws.iam.Role, document: pulumi.Output<PolicyDocument> }>()
const identities = new WeakMap<object, number>()
let nextIdentity = 0

const identity = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return JSON.stringify(value)
    if (!identities.has(value)) identities.set(value, nextIdentity++)
    return identities.get(value)
}

/** Lambdas with equal keys grant the same; undefined when that is known only at deploy. */
const grantsKey = (
    environment: string,
    callerStatements: aws.iam.PolicyStatement[],
    resources: LambdaResource[],
    options?: LambdaOptions
) => {
    const xray = options?.enableXRay ?? false
    if (callerStatements.length || typeof xray !== 'boolean') return undefined

    const grants = resources.map(({ access, ...resource }) => {
        const [kind, value] = Object.entries(resource).find(([, v]) => v !== undefined) ?? []
        return JSON.stringify([kind, identity(value), access.map(actionName).sort()])
    })
    return JSON.stringify([environment, Boolean(options?.vpcConfig), xray, grants.sort()])
}

const roleFor = (
    name: string,
    environment: string,
    statements: pulumi.Output<aws.iam.PolicyStatement[]>,
    key: string | undefined
): pulumi.Input<string> => {
    const dashed = dashedName(name, environment)
    const document = lift(statements, documentOf)
    if (key === undefined) return createRole(dashed, document).arn

    const shared = sharedRoles.get(key)
    if (shared) {
        return pulumi.all([shared.role.arn, shared.document, document]).apply(([arn, theirs, mine]) =>
            sameGrants(`${name}-${environment}`, theirs, mine, arn))
    }

    const role = createRole(dashed, document)
    sharedRoles.set(key, { role, document })
    return role.arn
}

export const sameGrants = (functionName: string, theirs: PolicyDocument, mine: PolicyDocument, roleArn: string) => {
    if (JSON.stringify(theirs) !== JSON.stringify(mine)) throw new Error(`${functionName} shares a role whose policy grants other than its own`)
    return roleArn
}

export const MANAGED_POLICY_LIMIT = 6144

const documentOf = (statements: ResolvedStatement[]): PolicyDocument =>
    ({ Version: "2012-10-17", Statement: [logsStatement, ...mergeStatements(statements)] })

export const policyDocument = (policyName: string, statements: ResolvedStatement[]) =>
    withinLimit(policyName, documentOf(statements))

const withinLimit = (policyName: string, document: PolicyDocument): PolicyDocument => {
    const size = JSON.stringify(document).length

    if (size > MANAGED_POLICY_LIMIT) {
        throw new Error(`${policyName} is ${size} characters, and IAM allows ${MANAGED_POLICY_LIMIT} in a managed policy`)
    }
    return document
}

const dashedName = (name: string, environment: string) =>
    `${name.replace(/[A-Z]/g, m => "-" + m.toLowerCase()).replace(/^-/, '')}-${environment}`

/** @deprecated createLambda chooses and builds a lambda's role; nothing in lambada calls this. */
export const createLambdaRoleAndPolicies = (
    name: string,
    environment: string,
    policyStatements: pulumi.Input<aws.iam.PolicyStatement[]>
) => {
    return createRole(dashedName(name, environment), lift(policyStatements ?? [], documentOf))
}

const createRole = (dashedNamed: string, document: pulumi.Output<PolicyDocument>) => {
    const policyName = `${dashedNamed}-policy`
    const role = new aws.iam.Role(`${dashedNamed}-role`, {
        name: `${dashedNamed}-role`,
        assumeRolePolicy: lambdaAssumeRole,
    })
    const policy = new aws.iam.Policy(policyName, {
        name: policyName,
        path: "/",
        policy: document.apply(d => withinLimit(policyName, d))
    })

    new aws.iam.RolePolicyAttachment(`${dashedNamed}-policy-attachment`, {
        policyArn: policy.arn,
        role: role
    })

    return role
}

// export type EnvironmentVariables = pulumi.Input<{
//     [key: string]: pulumi.Input<string>
// }> | undefined



export type LambdaResourceAccessItem = string

export type DynamoDbAccess = `dynamodb:${string}`

const INDEX_ACTIONS = ['Query', 'Scan', 'PartiQLSelect', 'SearchVectors', 'DescribeContributorInsights', 'UpdateContributorInsights']

/** No `ListStreams`: IAM scopes it to `*`. */
const STREAM_ACTIONS = [
    'DescribeStream', 'GetRecords', 'GetShardIterator', 'DeleteResourcePolicy', 'GetResourcePolicy',
    'PutResourcePolicy', 'ListTagsOfResource', 'TagResource', 'UntagResource',
]

const matchesAction = (pattern: string, action: string) => {
    const glob = actionName(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${glob}$`).test(actionName(action))
}

const onIndex = (pattern: LambdaResourceAccessItem) =>
    INDEX_ACTIONS.some(name => matchesAction(pattern, `dynamodb:${name}`))

const onStream = (pattern: LambdaResourceAccessItem) =>
    STREAM_ACTIONS.some(name => matchesAction(pattern, `dynamodb:${name}`))

export type SNSAccess = `sns:${string}`
export type SQSAccess = `sqs:${string}`
export type SecretAccess = `secretsmanager:${string}`
export type KmsAccess = `kms:${string}`
export type CognitoAccess = `cognito-idp:${string}`
export type S3Access = `s3:${string}`

export class LambdaResourceAccess {
    public static DynamoDbGetItem = "dynamodb:GetItem" as const
    public static DynamoDbGetAsterisk = "dynamodb:Get*" as const
    public static DynamoDbScan = "dynamodb:Scan" as const
    public static DynamoDbQuery = "dynamodb:Query" as const
    public static DynamoDbUpdateItem = "dynamodb:UpdateItem" as const
    public static DynamoDbDeleteItem = "dynamodb:DeleteItem" as const
    public static DynamoDbPutItem = "dynamodb:PutItem" as const
    public static SNSPublish = "sns:Publish" as const
}

export type LambdaDynamoDbResource = {
    table?: DatabaseResultItem
    bucket?: BucketResultItem
    topic?: MessagingResultItem
    queue?: QueueResultItem
    notification?: NotificationResult
    kmsKey?: SecurityResultItem
    secret?: SecretResultItem
    pool?: PoolResultItem
    arn?: Input<string> | Input<Input<string>[]>
    access: LambdaResourceAccessItem[]
}

export type LambdaResource = LambdaDynamoDbResource

export type FunctionVpcConfig = {
    /**
     * List of security group IDs associated with the Lambda function.
     */
    securityGroupIds: pulumi.Input<pulumi.Input<string>[]>;
    /**
     * List of subnet IDs associated with the Lambda function.
     */
    subnetIds: pulumi.Input<pulumi.Input<string>[]>;
}
