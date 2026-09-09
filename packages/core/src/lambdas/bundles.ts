import { LambdaFolder } from ".";

/**
 * Artifacts by function name: the manifest a build step wrote, or a lookup that reads it.
 * Structural, so the tool that produced it is nothing lambada has to name.
 */
export type BundleLookup = (name: string) => LambdaFolder | undefined

export type BundleSource = Record<string, LambdaFolder> | BundleLookup

export const isLambdaFolder = (value: unknown): value is LambdaFolder =>
    typeof value === 'object' && value !== null && typeof (value as LambdaFolder).functionFolder === 'string'

export const bundleOf = (source: BundleSource | undefined, name: string | undefined): LambdaFolder | undefined => {
    if (!source || name === undefined) return undefined

    return typeof source === 'function' ? source(name) : source[name]
}
