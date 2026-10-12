import type * as aws from "@pulumi/aws";
import type { EmbroideryEnvironmentVariables } from "..";
import type { LambadaGrantsShape, LambadaResourceRequest } from "../resources/grants";
import type { LambdaFolder, LambdaOptions } from ".";

/** What every declared function is tuned by, whatever triggers it. */
export type LambadaFunctionTuning = {
    environmentVariables?: EmbroideryEnvironmentVariables
    lambdaOptions?: LambdaOptions
}

/**
 * A function an event source triggers: a subscription, a queue handler or a schedule. An endpoint
 * differs where API Gateway does: its name can come from its route, and its callback is wrapped.
 */
export type LambadaTriggeredFunction<THandler, TNames extends LambadaGrantsShape = LambadaGrantsShape> = LambadaFunctionTuning & {
    name: string
    /** A `FolderLambda` deploys a pre-built bundle instead of a serialized closure. */
    callback: THandler | LambdaFolder
    policyStatements?: aws.iam.PolicyStatement[]
    resources: LambadaResourceRequest<TNames>
}

/** `options` is an endpoint's older name for `lambdaOptions`; a declaration says it once. */
export const lambdaOptionsProblems = (name: string, declaration: { options?: unknown, lambdaOptions?: unknown }): string[] =>
    declaration.options !== undefined && declaration.lambdaOptions !== undefined
        ? [`${name}: sets both options and lambdaOptions, which are one setting. Keep lambdaOptions.`]
        : []

export const lambdaOptionsOf = (name: string, declaration: { options?: LambdaOptions, lambdaOptions?: LambdaOptions }): LambdaOptions | undefined => {
    const problems = lambdaOptionsProblems(name, declaration)
    if (problems.length > 0) throw new Error(problems.join('\n'))
    return declaration.lambdaOptions ?? declaration.options
}
