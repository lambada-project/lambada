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
    /** A declaration AWS would refuse, said as the sentence that explains why. */
    invalid(reason: string): void
    /** Throws a single error naming every missing resource, if there were any. */
    throwIfIncomplete(): void
}

const column = (rows: string[]) => Math.max(...rows.map(x => x.length), 0)

export const createDiagnostics = (): LambadaDiagnostics => {
    const missing: MissingResource[] = []
    const invalid: string[] = []

    return {
        missingResource: item => { missing.push(item) },
        invalid: reason => { invalid.push(reason) },

        throwIfIncomplete() {
            if (missing.length === 0 && invalid.length === 0) return

            const width = column(missing.map(x => x.functionName))
            const missingSection = missing.length === 0 ? [] : [
                `Lambada found ${missing.length} ` +
                `${missing.length === 1 ? 'resource that is' : 'resources that are'} granted but absent ` +
                `from the stack:\n\n` +
                missing.map(x => {
                    const has = x.available.length ? x.available.join(', ') : 'none'
                    return `  ${x.functionName.padEnd(width)}  ${x.kind} '${x.name}' — the stack has: ${has}`
                }).join('\n') +
                `\n\nCorrect the names, or add the resources to run().`
            ]
            const invalidSection = invalid.length === 0 ? [] : [
                `Lambada found ${invalid.length} invalid ${invalid.length === 1 ? 'declaration' : 'declarations'}:\n\n` +
                invalid.map(x => `  ${x}`).join('\n')
            ]

            throw new Error([...missingSection, ...invalidSection].join('\n\n'))
        },
    }
}
