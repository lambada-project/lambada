export type MissingResource = {
    functionName: string
    kind: string
    name: string
    /** What the stack does carry of that kind, so the message can show the near misses. */
    available: string[]
}

/**
 * Problems found across the whole stack, reported once rather than one deploy at a time. Fixing a
 * name only to hit the next one on the next deploy is the slowest way to learn what is missing.
 */
export type LambadaDiagnostics = {
    missingResource(missing: MissingResource): void
    /** Throws a single error naming every missing resource, if there were any. */
    throwIfIncomplete(): void
}

const column = (rows: string[]) => Math.max(...rows.map(x => x.length), 0)

export const createDiagnostics = (): LambadaDiagnostics => {
    const missing: MissingResource[] = []

    return {
        missingResource: item => { missing.push(item) },

        throwIfIncomplete() {
            if (missing.length === 0) return

            const width = column(missing.map(x => x.functionName))
            const lines = missing.map(x => {
                const has = x.available.length ? x.available.join(', ') : 'none'
                return `  ${x.functionName.padEnd(width)}  ${x.kind} '${x.name}' — the stack has: ${has}`
            })

            throw new Error(
                `Lambada found ${missing.length} ` +
                `${missing.length === 1 ? 'resource that is' : 'resources that are'} granted but absent ` +
                `from the stack:\n\n${lines.join('\n')}\n\n` +
                `Correct the names, or add the resources to run().`
            )
        },
    }
}
