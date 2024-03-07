import { Request, Response, Route } from '@pulumi/awsx/classic/apigateway/api'
import * as aws from "@pulumi/aws";
import * as pulumi from '@pulumi/pulumi'
import { createLambda, FolderLambda, FunctionVpcConfig, LambdaOptions, LambdaResource } from '../lambdas';
import { LambadaResources } from '../context';
import { Callback } from '@pulumi/aws/lambda';
import { PolicyStatement } from "@pulumi/aws/iam";
import { AuthExecutionContext } from '@lambada/utils';
import { EmbroideryEnvironmentVariables } from '..';
import { CognitoAuthorizer, LambdaAuthorizer, Method } from '@pulumi/awsx/classic/apigateway';
import { getNameFromPath } from './utils';
import { createWebhook } from './createWebhook';
import { createCallback } from './callbackWrapper';
import { QueueArgs } from '@pulumi/aws/sqs';
import { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'




export type EmbroideryRequest = {
    user?: AuthExecutionContext
    request: Request
}

export type DistributiveOmit<T, K extends keyof T> = T extends any ? Omit<T, K> : never
export type EmbroideryCallback = (event: EmbroideryRequest) => Promise<object>
export type EmbroideryEventHandlerRoute = Route
export type LambadaEndpointArgs = {
    /** Custom name for your lambda, if empty it will take a name based on the path-verb */
    name?: string,
    path: string,
    method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH",
    useBundle?: string,
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    environmentVariables?: EmbroideryEnvironmentVariables,
    openapi?: (registry: OpenAPIRegistry) => DistributiveOmit<RouteConfig, 'path' | 'method'>
    webhook?: {
        wrapInQueue: boolean,
        options?: QueueArgs,
        /**
         * If empty, it will set a default static value
         */
        messageGroupId?: {
            field: string
            source: "BODY"// | "PATH"
        }
    },
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
    },
    options?: LambdaOptions
}

export const createEndpointSimpleCors = <T>(
    name: string,
    embroideryContext: LambadaResources,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean
        useApiKey?: boolean
    },
    options?: LambdaOptions,
) => {
    return createEndpointSimple(name, embroideryContext, path, method, callbackDefinition, resources,
        {
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
        },
        auth,
        options
    )
}

export const createEndpointSimple = (
    name: string,
    context: LambadaResources,
    path: string,
    method: "GET" | "POST" | "DELETE",
    callbackDefinition: EmbroideryCallback,
    resources?: LambdaResource[],
    extraHeaders?: {},
    /** This overrides at endpoint level any default set */
    auth?: {
        useCognitoAuthorizer?: boolean,
        useApiKey?: boolean,
        lambdaAuthorizer?: LambdaAuthorizer
    },
    options?: LambdaOptions
) => createEndpointSimpleCompat({
    name,
    path,
    method,
    callbackDefinition,
    resources,
    extraHeaders,
    auth,
    environmentVariables: undefined,
    options
}, context)

export const createEndpointSimpleCompat = (args: LambadaEndpointArgs, context: LambadaResources): EmbroideryEventHandlerRoute => {
    args.name = args.name ?? getNameFromPath(`${context.projectName}-${args.path}-${args.method.toLowerCase()}`)

    const {
        name,
        path,
        method,
        callbackDefinition,
        resources,
        extraHeaders,
        auth,
        environmentVariables,
        options,
        webhook,
    } = args

    if (webhook?.wrapInQueue) {
        return createWebhook(args, context)
    }
    else if (args.useBundle) {
        return runBundle(args, context);
    }
    else {
        return createEndpoint<Request, Response>(
            name, context,
            path, method, createCallback({ callbackDefinition, context, extraHeaders }), [],
            environmentVariables, auth?.useCognitoAuthorizer,
            resources,
            auth?.useApiKey,
            auth?.lambdaAuthorizer,
            options
        )
    }
}

export type LambadaEndpointResult<E, R> = {
    path: string,
    method: Method,
    authorizers: (LambdaAuthorizer | CognitoAuthorizer)[],
    eventHandler: aws.lambda.EventHandler<E, R>
    apiKeyRequired: boolean | undefined
}
export type HTTP_METHODS = "GET" | "POST" | "DELETE" | "PUT" | "PATCH" | "OPTIONS"
export const createEndpoint = <E, R>(
    name: string,
    embroideryContext: LambadaResources,
    path: string,
    method: HTTP_METHODS,
    callbackDefinition: Callback<E, R> | FolderLambda,
    policyStatements: aws.iam.PolicyStatement[],
    environmentVariables: EmbroideryEnvironmentVariables = undefined,
    enableAuth = true,
    resources?: LambdaResource[],
    apiKeyRequired?: boolean,
    lambdaAuthorizer?: LambdaAuthorizer,
    options?: LambdaOptions
): LambadaEndpointResult<E, R> => {

    var environment = embroideryContext.environment
    resources = resources || []

    if (!policyStatements) {
        policyStatements = []
    }

    if (embroideryContext.kmsKeys && embroideryContext.kmsKeys.dynamodb) {
        resources.push(
            {
                kmsKey: embroideryContext.kmsKeys.dynamodb,
                access: [
                    "kms:Encrypt",
                    "kms:Decrypt",
                    "kms:ReEncrypt*",
                    "kms:GenerateDataKey*",
                    "kms:DescribeKey"
                ],
            })
    }

    const envVars = { ...(embroideryContext.environmentVariables || {}), ...(environmentVariables || {}) }

    const callback = createLambda<E, R>(
        name,
        environment,
        callbackDefinition,
        policyStatements,
        envVars,
        resources,
        undefined,
        {
            ...options,
            vpcConfig: options?.vpcConfig ?? embroideryContext.api?.vpcConfig
        }
    )

    let auth: (CognitoAuthorizer | LambdaAuthorizer)[] = []

    if (lambdaAuthorizer)
        auth.push(lambdaAuthorizer)
    else if (typeof enableAuth === 'boolean' ? enableAuth : embroideryContext?.api?.auth?.useCognitoAuthorizer === true)
        auth = [...auth, ...(embroideryContext.authorizers ?? [])]

    return {
        path: `${embroideryContext.api?.apiPath ?? ''}${path}`,
        method: method,
        authorizers: auth,
        eventHandler: callback,
        apiKeyRequired: typeof apiKeyRequired === 'boolean' ? apiKeyRequired : embroideryContext?.api?.auth?.useApiKey === true
    }
}

function runBundle(args: LambadaEndpointArgs, context: LambadaResources): EmbroideryEventHandlerRoute {
    const getRelativePath = (from: string, to: string) => {
        return from.split('/').slice(2).map(() => '..').join('/') + '/' + to;
    };

    const readDependencies = (): { [key: string]: string } => {
        const packageJsonPath = join(process.cwd(), 'package.json');
        const packageJsonData = readFileSync(packageJsonPath, 'utf-8');
        const packageJsonObj = JSON.parse(packageJsonData) ?? {};

        if (packageJsonObj.pulumi?.customSerializer?.includeDependencies === false)
            return {}
        if (Array.isArray(packageJsonObj.pulumi?.customSerializer?.includeDependencies))
            return packageJsonObj.pulumi?.customSerializer?.includeDependencies

        return packageJsonObj.dependencies ?? {}
    };

    args.name = args.name ?? getNameFromPath(`${context.projectName}-${args.path}-${args.method.toLowerCase()}`)

    const {
        name,
        path,
        method,
        callbackDefinition,
        resources,
        extraHeaders,
        auth,
        environmentVariables,
        options,
        webhook,
    } = args

    if (!args.useBundle) throw new Error('useBundle is required')


    //const handlerLocation = 'LOCATION'// await locate(args.callbackDefinition);



    const mainFileName = `main.js`;
    const handlerFileName = `handler.js`;
    const mainFilePath = args.useBundle

    const hash = name;
    const run = 'testing' //Date.now().toString();
    const handlerName = 'lambda_handler';
    const bundleDirectory = `/tmp/lambada/${run}/lambda-${hash}`;
    execSync(`rm -rf ${bundleDirectory}/*`)

    //'@lambada/core/*'
    const excludeDependencies = ['@pulumi/*', 'aws-sdk']
    const dependencies = readDependencies()
    const externalFlat = [...Object.keys(dependencies), ...excludeDependencies].flatMap(x => ['--external', x]).join(' ')
    
    
    mkdirSync(bundleDirectory, { recursive: true });


    /** WRAPPER */
    const wrapperPath = `${bundleDirectory}/wrapper.ts`
    writeFileSync(wrapperPath, `
    import { getContext } from '@lambada/utils';

    const isResponse = (result: any): boolean => {
        return result && (
            result.body && result.statusCode
        )
    }

    export const callback = async (request: Request, callbackDefinition: any): Promise<Response> => {
        const extraHeaders = {}
        const authContext = await getContext(request)
        try {
            const result = await callbackDefinition({
                user: authContext,
                request
            })

            if (isResponse(result)) {

                const resultTyped = result as any

                if (typeof resultTyped.body !== 'string') {
                    resultTyped.body = JSON.stringify(resultTyped.body)
                }

                return {
                    ...resultTyped,
                    headers: {
                        ...(resultTyped.headers || {}),
                        ...(extraHeaders || {})
                    }
                }
            }

            return {
                statusCode: 200,
                body: JSON.stringify(result ?? {}),
                headers: (extraHeaders || {})
            }

        } catch (ex: any) {
            console.error(ex)
            const showErrorDetails = ex && (ex.showError || process.env['LAMBADA_SHOW_ALL_ERRORS'] == 'true')
            if (showErrorDetails) {
                return {
                    statusCode: ex.statusCode ?? 500,
                    body: JSON.stringify({

                        error: {
                            message: ex.message ?? ex.errorMessage,
                            code: ex.code ?? ex.errorCode,
                            data: ex.data
                        },

                        errors: [
                            {
                                message: ex.message ?? ex.errorMessage,
                                code: ex.code ?? ex.errorCode,
                                data: ex.data
                            }
                        ]
                    }),
                    headers: (extraHeaders || {})
                }
            } else {
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        error: 'Bad Request'
                    }),
                    headers: (extraHeaders || {})
                }
            }
        }
    }

    `);


    /** ENTRYPOINT */
    const entryPointPath = `${bundleDirectory}/${handlerFileName}`
    writeFileSync(entryPointPath, `
        import {handler} from '${mainFilePath}';
        import {callback} from './wrapper';
        

        export const ${handlerName} = (e)=>callback(e, handler);
        
    `);

    writeFileSync(entryPointPath + '-2.js', `
        import {handler} from '${mainFilePath}';
        export const ${handlerName} = handler;
    `);


    // hay que user outdir when --splitting is used
    const script = `node_modules/bun/bin/bun build --splitting --target node  ${externalFlat} --outdir ${bundleDirectory} ${entryPointPath} ${entryPointPath + '-2.js'}`;
    console.log(script)
    execSync(script)


    writeFileSync(`${bundleDirectory}/package.json`, ` {
        "main": "./${handlerFileName}",
        "type": "module",
        "dependencies": {
            ${Object.entries(dependencies)
            .filter(x => !excludeDependencies.includes(x[0]))
            .map(x => `"${x[0]}": "${x[1]}"`).join(',')}
        }     
    }`);

    execSync(`cd ${bundleDirectory} && npm i`)

    const folderLambda: FolderLambda = {
        functionFolder: bundleDirectory,
        handler: `${handlerFileName.replace('.js', '')}.${handlerName}`
    };


    return createEndpoint<Request, Response>(
        name, context,
        path, method, folderLambda, [],
        environmentVariables, auth?.useCognitoAuthorizer,
        resources,
        auth?.useApiKey,
        auth?.lambdaAuthorizer,
        options
    );
}
