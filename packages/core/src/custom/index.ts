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

/** Each custom resource as a grant resolves it. A result of an earlier run passes through. */
export const createCustom = (customRef?: LambadaCustomRef | CustomResult): CustomResult => {
    const result: CustomResult = {}

    for (const key in customRef) {
        if (Object.prototype.hasOwnProperty.call(customRef, key)) {
            const { service, resources, environment } = customRef[key]
            if (!SERVICE.test(service)) {
                throw new Error(`Cannot declare the custom resource '${key}': service '${service}' is not an IAM prefix, such as 'es' or 'execute-api'.`)
            }
            result[key] = {
                service,
                resources: pulumi.output(resources).apply(r => [r].flat()),
                environment: { ...environment },
            }
        }
    }

    return result
}

/** The actions of a grant that belong to another service than the resource's. IAM ignores their case. */
export const foreignActions = (item: CustomResultItem, actions: readonly string[]): string[] =>
    actions.filter(action => !action.toLowerCase().startsWith(`${item.service}:`))
