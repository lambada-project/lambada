import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Stack = {
    name: string
    /** The stack's settings file, relative to the repo. */
    file: string
    /** `secretsprovider` from the settings file; left out, Pulumi Cloud encrypts the stack's secrets. */
    secretsProvider?: string
}

export type Project = {
    name: string
    /** The directory holding `Pulumi.yaml`, relative to the repo. */
    dir: string
    stacks: Stack[]
}

const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])

/** Every file under `root` whose name `wanted` accepts, skipping dependencies, build output and hidden directories (git worktrees live there). */
export const findFiles = (root: string, wanted: (name: string) => boolean, depth = 6): string[] => {
    const found: string[] = []
    const walk = (dir: string, level: number) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (level < depth && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), level + 1)
            } else if (wanted(entry.name)) found.push(join(dir, entry.name))
        }
    }
    walk(root, 0)
    return found.sort()
}

const topLevel = (yaml: string, key: string) => new RegExp(`^${key}:[ \\t]*["']?([^"'\\s#]+)`, 'm').exec(yaml)?.[1]

export const findProjects = (root: string): Project[] =>
    findFiles(root, name => name === 'Pulumi.yaml' || name === 'Pulumi.yml').map(file => {
        const dir = file.slice(0, file.lastIndexOf('/'))
        const name = topLevel(readFileSync(file, 'utf8'), 'name')
        if (!name) throw new Error(`${relative(root, file)} names no project`)
        const stacks = readdirSync(dir)
            .map(f => /^Pulumi\.(.+)\.ya?ml$/.exec(f))
            .filter((m): m is RegExpExecArray => m !== null)
            .map(([f, stack]) => ({ name: stack, file: relative(root, join(dir, f)), secretsProvider: topLevel(readFileSync(join(dir, f), 'utf8'), 'secretsprovider') }))
            .sort((a, b) => a.name.localeCompare(b.name))
        return { name, dir: relative(root, dir) || '.', stacks }
    })

/**
 * Why a name cannot live in the Postgres backend. It finds a stack's rows with SQL `LIKE` and does not
 * escape the pattern, so `_` and `%` match other stacks' rows; the CLI then fails on them, and a stack
 * left that way cannot even be removed.
 */
export const nameProblem = (kind: 'project' | 'stack', name: string): string | undefined =>
    /[_%]/.test(name) ? `${kind} '${name}' holds '_' or '%', which the Postgres backend reads as a wildcard. Rename it before migrating.` : undefined
