import { getNameFromPath } from "../api/utils";
import { LambadaResources } from "../context";
import { LambadaDiagnostics, MissingResource } from "./diagnostics";
import { findMissingGrants, isLambadaGrants, LambadaResourceRequest, ResourceKind, resourceLookups } from "./grants";

/**
 * As much of a handler as this pass can see without running anything. A creator has to be executed
 * to say what it wants, and executing one builds infrastructure, so only plain declarations are
 * checked here — which is the whole point of declaring them as plain objects.
 *
 * A handler may name the resource it binds to under the key for that kind: `topic` on a
 * subscription, `queue` on a queue handler. Every kind is looked for, so a new one is covered by
 * being added to `resourceLookups` and nowhere else.
 */
type Declaration = {
    name?: string
    path?: string
    method?: string
    resources?: LambadaResourceRequest<any>
} & Partial<Record<ResourceKind, unknown>>

/**
 * What the built function will be called. An endpoint may leave `name` out — `createEndpoint` derives
 * it from the path, but only later, so this pass derives the same one rather than reporting on
 * `undefined`.
 */
const declarationName = (context: LambadaResources, declaration: Declaration): string =>
    declaration.name
    ?? (declaration.path && declaration.method
        ? getNameFromPath(`${context.projectName}-${declaration.path}-${declaration.method.toLowerCase()}`)
        : '(unnamed)')

const isDeclaration = (definition: unknown): definition is Declaration =>
    typeof definition === 'object' && definition !== null

/** Every resource this handler binds to by name that the stack cannot resolve. */
const missingBindings = (
    context: LambadaResources,
    functionName: string,
    declaration: Declaration
): MissingResource[] =>
    Object.entries(resourceLookups(context)).flatMap(([kind, record]) => {
        const name = declaration[kind as ResourceKind]

        if (typeof name !== 'string' || record?.[name] !== undefined) return []

        return [{ functionName, kind, name, available: Object.keys(record ?? {}) }]
    })

/**
 * Checks every plain declaration against the stack before a single function is built, so a run with
 * several bad names fails once, naming all of them, rather than once per deploy.
 */
export const preflight = (
    context: LambadaResources,
    diagnostics: LambadaDiagnostics,
    definitions: readonly (readonly unknown[] | undefined)[]
): void => {
    for (const group of definitions) {
        for (const definition of group ?? []) {
            if (!isDeclaration(definition)) continue

            const name = declarationName(context, definition)

            for (const missing of missingBindings(context, name, definition)) {
                diagnostics.missingResource(missing)
            }

            if (isLambadaGrants(definition.resources)) {
                for (const missing of findMissingGrants(context, { name, resources: definition.resources })) {
                    diagnostics.missingResource(missing)
                }
            }
        }
    }

    diagnostics.throwIfIncomplete()
}
