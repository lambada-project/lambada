import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MOVED_TAG, movedAt } from './freeze'
import { copyDifferences } from './migrate'
import { cloudVersion, must, Pulumi } from './pulumi'
import { Config, configDifferences, Exported } from './state'

export type StackReturn = {
    pulumi: Pulumi
    /** The project directory, where `Pulumi.<stack>.yaml` lives. */
    cwd: string
    /** The Pulumi Cloud stack it moved from, `<org>/<project>/<stack>`. */
    source: string
    stack: string
    log: (line: string) => void
}

/** `Pulumi.<stack>.yaml` without the target's encryption and config, for Pulumi Cloud, which keeps its key itself. */
export const cloudSettings = (yaml: string): string => {
    const lines: string[] = []
    let dropping = false
    for (const line of yaml.split('\n')) {
        if (/^(secretsprovider|encryptedkey|encryptionsalt|config):/.test(line)) dropping = true
        else if (dropping && (line === '' || /^[ \t]/.test(line))) continue
        else { dropping = false; lines.push(line) }
    }
    return lines.join('\n')
}

/**
 * The way back once the target has deployed: its state and config go into the Pulumi Cloud stack it
 * moved from, which keeps its history, and the copy is proved. The Pulumi Cloud stack must be as it
 * was tagged when it moved; otherwise both backends have deployed, and only a person can reconcile
 * them. Nothing changes until every check has passed. Secrets reach the CLI on stdin, never as arguments.
 */
export const backStack = ({ pulumi, cwd, source, stack, log }: StackReturn): { version: number } => {
    const cloud = (args: string[], what: string, input?: string) => must(pulumi(args, { backend: 'cloud', cwd, input }), what)
    const target = (args: string[], what: string) => must(pulumi(args, { backend: 'target', cwd }), what)

    const tags: Record<string, string> = JSON.parse(cloud(['stack', 'tag', 'ls', '--json', '-s', source], `reading the tags of ${source}`) || '{}')
    if (tags[MOVED_TAG] === undefined) throw new Error(`${source} has no ${MOVED_TAG} tag, so nothing shows it was left alone since the move. Run \`freeze\` first if it was.`)
    const moved = movedAt(source, tags[MOVED_TAG])
    const cloudNow = cloudVersion(pulumi, cwd, source)
    if (cloudNow !== moved.version) throw new Error(`${source} was deployed on Pulumi Cloud after it moved (version ${moved.version} → ${cloudNow}). Both backends have deployed; reconcile them by hand.`)
    const provider = (JSON.parse(cloud(['stack', 'export', '-s', source], `exporting ${source}`)) as Exported).deployment.secrets_providers?.type
    if (provider !== 'service') throw new Error(`${source} encrypts with ${provider}, not Pulumi Cloud's own key; go back by hand.`)

    // The state itself shows a deploy: a DIY backend numbers every update 0.
    const exportTarget = () => target(['stack', 'export', '-s', stack], `exporting ${stack}`)
    const state = exportTarget()
    const config: Config = JSON.parse(target(['config', '--show-secrets', '--json', '-s', stack], `reading the config of ${stack}`))
    const structuredSecrets = Object.keys(config).filter(k => config[k].secret && 'objectValue' in config[k])
    if (structuredSecrets.length > 0) throw new Error(`${structuredSecrets.join(', ')}: a secret holding a map or list cannot be set without its value in the arguments; set it on ${source} by hand, remove it from the target, and run again.`)
    const dir = mkdtempSync(join(tmpdir(), 'state-back-'))
    try {
        const file = join(dir, 'state.json')
        // Exported without --show-secrets: the secrets stay encrypted, and the import re-encrypts them for Pulumi Cloud.
        writeFileSync(file, state, { mode: 0o600 })
        if (exportTarget() !== state) throw new Error(`${stack} was deployed while being read. Stop its deploys, then run again.`)
        log(`${stack}: returning to ${source}`)

        const settings = join(cwd, `Pulumi.${stack}.yaml`)
        writeFileSync(settings, cloudSettings(readFileSync(settings, 'utf8')))
        try {
            const plain = Object.fromEntries(Object.entries(config).filter(([, v]) => !v.secret))
            if (Object.keys(plain).length > 0) cloud(['config', 'set-all', '--json', JSON.stringify(plain), '-s', source], `setting the config of ${source}`)
            for (const [key, { value }] of Object.entries(config).filter(([, v]) => v.secret)) {
                cloud(['config', 'set', key, '--secret', '--raw', '-s', source], `setting ${key} on ${source}`, value ?? '')
            }
            cloud(['stack', 'import', '--file', file, '-s', source], `importing ${stack} into ${source}`)
        } catch (error) {
            throw new Error(`${(error as Error).message}\nPulumi.${stack}.yaml now holds part of the config for Pulumi Cloud; restore the target's from git, such as with \`git checkout -- Pulumi.${stack}.yaml\`, before running again.`)
        }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }

    const differences = [
        ...copyDifferences(pulumi, cwd, source, stack, 'target'),
        ...configDifferences(config, JSON.parse(cloud(['config', '--show-secrets', '--json', '-s', source], `reading the config of ${source}`))),
    ]
    if (differences.length > 0) throw new Error(`${source} differs from ${stack} after the import:\n  ${differences.join('\n  ')}\nIts history holds each version; it is still tagged as moved.`)
    cloud(['stack', 'tag', 'rm', MOVED_TAG, '-s', source], `untagging ${source}`)
    const version = cloudVersion(pulumi, cwd, source)
    log(`${source}: matches ${stack} at version ${version}`)
    return { version }
}
