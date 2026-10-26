import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { grantsPolicyDocument, resourceStatements, tableKeyStatements } from ".";
import type { LambadaResources } from "../context";
import { LambadaGrants, LambadaGrantsShape, resolveGrants } from "../resources/grants";

/** What run() returns that a grant resolves against. */
export type GrantStack = {
    databases: LambadaResources['databases']
    buckets: LambadaResources['buckets']
    secrets: LambadaResources['secrets']
    messaging: LambadaResources['messaging']
    queues: LambadaResources['queues']
    pools: LambadaResources['pools']
    custom?: LambadaResources['custom']
    security: LambadaResources['kmsKeys']
}

/**
 * Gives a role this stack does not have lambada build the access a lambada function declaring the same
 * resources gets, as an inline policy on it. The function and the role stay whatever they are.
 *
 * Only what was granted: an `envVar` grant sets variables on a function, and the logs a lambada function
 * writes are its own role's, both belonging to whoever builds the function.
 */
export const grant = <TNames extends LambadaGrantsShape = LambadaGrantsShape>(
    stack: GrantStack,
    role: aws.iam.Role,
    name: string,
    resources: Omit<LambadaGrants<TNames>, 'envVar'>,
    environment = '',
): aws.iam.RolePolicy => {
    if ((resources as LambadaGrants).envVar !== undefined) {
        throw new Error(`grant gives ${name} IAM only; set its environment variables where its function is built.`)
    }

    const context = { ...stack, kmsKeys: stack.security }
    const granted = resolveGrants(context, { name, resources: resources as LambadaGrants<TNames> })
    const statements = granted.flatMap(access => resourceStatements(access, name, environment).statements)
    const tables = pulumi.all(granted.flatMap(access => access.table ? [access.table.ref] : []))

    const all = pulumi.output(tables.apply(refs => [...statements, ...tableKeyStatements(refs)]))

    return new aws.iam.RolePolicy(`${name}-grants`, {
        role: role.name,
        policy: all.apply(resolved => JSON.stringify(grantsPolicyDocument(`${name}-grants`, resolved))),
    })
}
