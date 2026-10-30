import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloudVersion, must, PULUMI_CLOUD, Pulumi } from './pulumi'
import { nameProblem } from './scan'
import { Config, configDifferences, Exported, stateDifferences } from './state'

export type StackMigration = {
    pulumi: Pulumi
    /** The project directory, where `Pulumi.<stack>.yaml` lives. */
    cwd: string
    org: string
    project: string
    stack: string
    /** For the target stack, such as `awskms://alias/pulumi-state?region=us-east-1`. */
    secretsProvider: string
    log: (line: string) => void
}

export type Migrated = {
    /** The Pulumi Cloud version the copy matches. */
    version: number
    /** Whether a deploy landed on Pulumi Cloud during the move, so the copy was taken again. */
    recopied: boolean
}

/** How the target's copy of a stack differs in state from its Pulumi Cloud source, secrets decrypted. */
export const copyDifferences = (pulumi: Pulumi, cwd: string, source: string, stack: string): string[] => {
    const exported = (backend: 'cloud' | 'target', name: string): Exported =>
        JSON.parse(must(pulumi(['stack', 'export', '--show-secrets', '-s', name], { backend, cwd }), `exporting ${name}`))
    return stateDifferences(exported('cloud', source), exported('target', stack))
}

/**
 * Copies a stack from Pulumi Cloud and proves the copy: every resource, every config value and secret,
 * and the Pulumi Cloud version it was taken at. The source is left as it was. A deploy that lands on
 * Pulumi Cloud meanwhile leaves the copy behind, unnoticed by the target's own preview, so the version
 * is read again after the check and the copy is taken again once; a stack that keeps moving is refused.
 */
export const migrateStack = ({ pulumi, cwd, org, project, stack, secretsProvider, log }: StackMigration): Migrated => {
    const source = `${org}/${project}/${stack}`
    const cloud = (args: string[], what: string) => must(pulumi(args, { backend: 'cloud', cwd }), what)
    const target = (args: string[], what: string) => must(pulumi(args, { backend: 'target', cwd }), what)

    for (const problem of [nameProblem('project', project), nameProblem('stack', stack)]) if (problem) throw new Error(problem)
    const existing: { name: string }[] = JSON.parse(target(['stack', 'ls', '--json'], 'listing the target stacks') || '[]')
    if (existing.some(s => s.name.split('/').pop() === stack)) {
        throw new Error(`${stack} already exists in the target. To copy it again, remove the copy with \`pulumi stack rm --force -s ${stack}\` against the target; its resources stay. That deletes Pulumi.${stack}.yaml, which the copy re-encrypted, so restore the Pulumi Cloud one, such as with \`git checkout -- Pulumi.${stack}.yaml\`, and migrate again.`)
    }

    const version = () => cloudVersion(pulumi, cwd, source)
    const sourceConfig: Config = JSON.parse(cloud(['config', '--show-secrets', '--json', '-s', source], `reading the config of ${source}`))
    const prove = () => {
        const differences = [
            ...copyDifferences(pulumi, cwd, source, stack),
            ...configDifferences(sourceConfig, JSON.parse(target(['config', '--show-secrets', '--json', '-s', stack], `reading the config of ${stack}`))),
        ]
        if (differences.length > 0) {
            throw new Error(`The copy of ${source} differs from it:\n  ${differences.join('\n  ')}\nRemove the copy with \`pulumi stack rm --force -s ${stack}\` against the target before trying again.`)
        }
    }

    const before = version()
    log(`${source}: version ${before}; copying`)
    target(['stack', 'migrate', PULUMI_CLOUD, source, '--secrets-provider', secretsProvider, '--yes'], `migrating ${source}`)
    prove()
    const at = version()
    if (at === before) {
        log(`${stack}: matches ${source} at version ${at}`)
        return { version: at, recopied: false }
    }

    log(`${source} moved to version ${at} during the copy; copying again`)
    const dir = mkdtempSync(join(tmpdir(), 'state-migrate-'))
    try {
        const file = join(dir, 'state.json')
        // Exported without --show-secrets: the secrets stay encrypted, and the import re-encrypts them for the target.
        writeFileSync(file, cloud(['stack', 'export', '-s', source], `exporting ${source}`), { mode: 0o600 })
        target(['stack', 'import', '--file', file, '-s', stack], `importing ${source} into ${stack}`)
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
    prove()
    const after = version()
    if (after !== at) throw new Error(`${source} keeps moving (version ${at} → ${after}). Stop its deploys, then copy it again.`)
    log(`${stack}: matches ${source} at version ${after}`)
    return { version: after, recopied: true }
}
