/** A `pulumi stack export --show-secrets` file, as far as comparing two of them needs. */
export type Exported = { deployment: { resources?: Resource[], pending_operations?: unknown[], secrets_providers?: { type?: string } } }
type Resource = { urn: string, [field: string]: unknown }

/** What a resource is, apart from where its state is kept. */
const FIELDS = ['type', 'id', 'custom', 'inputs', 'outputs', 'parent', 'dependencies', 'provider', 'protect', 'propertyDependencies'] as const

/** Every difference between two exports of one stack: the backend and its encryption may change, nothing else. */
export const stateDifferences = (source: Exported, target: Exported): string[] => {
    const differences: string[] = []
    const byUrn = (e: Exported) => new Map((e.deployment.resources ?? []).map(r => [r.urn, r]))
    const [a, b] = [byUrn(source), byUrn(target)]
    for (const [urn, r] of a) {
        const o = b.get(urn)
        if (!o) differences.push(`${urn} is missing`)
        else for (const field of FIELDS) if (JSON.stringify(r[field]) !== JSON.stringify(o[field])) differences.push(`${urn} differs in ${field}`)
    }
    for (const urn of b.keys()) if (!a.has(urn)) differences.push(`${urn} was not in the source`)
    const pending = (e: Exported) => e.deployment.pending_operations?.length ?? 0
    if (pending(source) > 0) differences.push(`the source has ${pending(source)} pending operation(s): an update was interrupted. Run \`pulumi refresh\` on it first`)
    if (pending(target) !== pending(source)) differences.push(`pending operations differ: ${pending(source)} → ${pending(target)}`)
    return differences
}

/** `pulumi config --show-secrets --json`: key → value. */
export type Config = { [key: string]: { value?: string, secret?: boolean } }

export const configDifferences = (source: Config, target: Config): string[] => [
    ...Object.keys(source).filter(k => !(k in target)).map(k => `config ${k} is missing`),
    ...Object.keys(target).filter(k => !(k in source)).map(k => `config ${k} was not in the source`),
    ...Object.keys(source).filter(k => k in target && (source[k].value !== target[k].value || !!source[k].secret !== !!target[k].secret))
        .map(k => `config ${k} differs${source[k].secret ? ' (secret; values not shown)' : ''}`),
]
