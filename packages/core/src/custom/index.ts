import * as pulumi from "@pulumi/pulumi"

/**
 * A resource lambada has no kind for, granted by name like the others. Every kind is an IAM service,
 * the resources its actions apply to, and what a granted function is told; a kind of its own adds only
 * what its resource needs beyond that. A custom resource that proves itself is promoted to a kind,
 * keeping its grant, so the role it builds stays the same.
 */
export type CustomResourceDefinition = {
    /** The IAM prefix of every action a grant may name: `es`, `aoss`, `execute-api`. */
    service: string
    /** What the actions apply to, as IAM names it. */
    resources: pulumi.Input<string> | pulumi.Input<string>[]
    /** Published to every function granted this resource, by variable name. */
    environment?: { [envKeyName: string]: pulumi.Input<string> }
}

export type LambadaCustomRef = { [key: string]: CustomResourceDefinition }

export type CustomResultItem = {
    service: string
    resources: pulumi.Output<string[]>
    environment: { [envKeyName: string]: pulumi.Input<string> }
}

export type CustomResult = { [key: string]: CustomResultItem }

/** An IAM service prefix, which never holds the ':' that ends it. */
const SERVICE = /^[a-z0-9-]+$/

const REVIEWED = "State it in the function's policyStatements, where it is reviewed as written."

/** Services whose actions manage identities: a grant of one lets a function give itself more. */
const IDENTITY_SERVICES = ['iam', 'sts']

/**
 * What is wrong with a resource a custom grant applies to: it must be an ARN of its own service, with
 * no wildcard in partition, region or account, naming something narrower than everything. A wildcard
 * within the resource, such as a domain's paths, is how a service scopes its own resources.
 */
export const resourceProblem = (service: string, resource: string): string | undefined => {
    const arn = new RegExp(`^arn:[^:*?]+:${service}:[^:*?]*:[^:*?]*:(.+)$`).exec(resource)
    if (!arn) return `'${resource}' is not an ARN of its service '${service}' with partition, region and account spelled out`
    if (/^[*?]+$/.test(arn[1])) return `'${resource}' names every resource of its service`
    return undefined
}

const declarationProblem = (key: string, problem: string) => `Cannot declare the custom resource '${key}': ${problem}`

const requireResource = (key: string, service: string) => (resource: string) => {
    const problem = resourceProblem(service, resource)
    if (problem) throw new Error(`${declarationProblem(key, problem)}. ${REVIEWED}`)
    return resource
}

/** Each custom resource as a grant resolves it. A result of an earlier run passes through. */
export const createCustom = (customRef?: LambadaCustomRef | CustomResult): CustomResult => {
    const result: CustomResult = {}

    for (const key in customRef) {
        if (Object.prototype.hasOwnProperty.call(customRef, key)) {
            const { service, resources, environment } = customRef[key]
            if (!SERVICE.test(service)) {
                throw new Error(declarationProblem(key, `service '${service}' is not an IAM prefix, such as 'es' or 'execute-api'.`))
            }
            if (IDENTITY_SERVICES.includes(service)) {
                throw new Error(declarationProblem(key, `service '${service}' manages identities, so a grant of it lets a function give itself more. ${REVIEWED}`))
            }
            // Plain strings are checked now; an Output when it resolves, which preview reaches.
            const check = requireResource(key, service)
            for (const resource of [resources].flat()) if (typeof resource === 'string') check(resource)
            result[key] = {
                service,
                resources: pulumi.output(resources).apply(r => [r].flat().map(check)),
                environment: { ...environment },
            }
        }
    }

    return result
}

/** What is wrong with the actions of a grant: another service than the resource's, or a wildcard. IAM ignores their case. */
export const actionProblems = (item: CustomResultItem, actions: readonly string[]): string[] => {
    const foreign = actions.filter(action => !action.toLowerCase().startsWith(`${item.service}:`))
    const wildcards = actions.filter(action => !foreign.includes(action) && /[*?]/.test(action))
    return [
        ...(foreign.length ? [`${foreign.join(', ')}, outside its service '${item.service}'.`] : []),
        ...(wildcards.length ? [`${wildcards.join(', ')}, a wildcard: name each action. ${REVIEWED}`] : []),
    ]
}
