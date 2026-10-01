type IndexState = { name?: string, hashKey?: string, keySchemas?: unknown[], [field: string]: unknown }
type ResourceState = {
    type: string
    urn?: string
    outputs?: { name?: string, globalSecondaryIndexes?: IndexState[], [field: string]: unknown }
    [field: string]: unknown
}
export type StackExport = { deployment: { resources?: ResourceState[], [field: string]: unknown }, [field: string]: unknown }

/** Each DynamoDB index whose state records hashKey without keySchemas, which 1.31 would replace. */
export const indexesWithoutKeySchemas = (exported: StackExport) =>
    (exported.deployment.resources ?? [])
        .filter(resource => resource.type === 'aws:dynamodb/table:Table')
        .flatMap(resource => (resource.outputs?.globalSecondaryIndexes ?? [])
            .filter(index => index.hashKey && !index.keySchemas?.length)
            .map(index => ({ table: String(resource.outputs?.name ?? resource.urn), index: String(index.name) })))
