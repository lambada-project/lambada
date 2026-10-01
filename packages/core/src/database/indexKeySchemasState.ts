type KeySchema = { attributeName: string, keyType: string }
type IndexState = { hashKey?: string, rangeKey?: string, keySchemas?: KeySchema[], [field: string]: unknown }
type ResourceState = {
    type: string
    inputs?: { globalSecondaryIndexes?: IndexState[], [field: string]: unknown }
    outputs?: { globalSecondaryIndexes?: IndexState[], [field: string]: unknown }
    [field: string]: unknown
}
export type StackExport = { deployment: { resources?: ResourceState[], [field: string]: unknown }, [field: string]: unknown }

/**
 * A stack's exported state with each DynamoDB index stating its hashKey and rangeKey as keySchemas
 * too, which is the state a deploy stating both forms leaves. Over it, an index declared by
 * keySchemas alone, or by hashKey and rangeKey alone, deploys unchanged. Over the state before,
 * keySchemas alone replaces the index.
 */
export const withIndexKeySchemas = (exported: StackExport): { state: StackExport, patched: number } => {
    let patched = 0

    const index = (state: IndexState): IndexState => {
        if (!state.hashKey || state.keySchemas?.length) return state
        patched++
        return {
            ...state,
            keySchemas: [
                { attributeName: state.hashKey, keyType: 'HASH' },
                ...(state.rangeKey ? [{ attributeName: state.rangeKey, keyType: 'RANGE' }] : []),
            ],
        }
    }
    const side = <S extends ResourceState['inputs']>(state: S): S =>
        state?.globalSecondaryIndexes ? { ...state, globalSecondaryIndexes: state.globalSecondaryIndexes.map(index) } : state

    const resources = exported.deployment.resources?.map(resource => resource.type === 'aws:dynamodb/table:Table'
        ? { ...resource, inputs: side(resource.inputs), outputs: side(resource.outputs) }
        : resource)

    return { state: { ...exported, deployment: { ...exported.deployment, resources } }, patched }
}
