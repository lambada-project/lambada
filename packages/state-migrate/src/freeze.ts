import { copyDifferences } from './migrate'
import { cloudVersion, must, Pulumi } from './pulumi'

/** The Pulumi Cloud stack tag recording the version a stack moved at: `version <n> at <ISO time>`. */
export const MOVED_TAG = 'lambada-state:moved'

export type Frozen =
    | { state: 'tagged', version: number }
    | { state: 'unchanged', version: number, at: string }
    | { state: 'deployed', version: number, at: string, now: number }

/**
 * Pulumi Cloud cannot make a stack read-only short of team permissions; what keeps deploys off it is
 * that no token logs in, which the opening step checks in CI. The stack stays, with its history, for
 * the way back. Its tag records the version it moved at, so a deploy that lands there later shows.
 * The first freeze proves the copy still equals the source: a deploy between the copy and the freeze
 * would otherwise be tagged as the version that moved. Config is not compared; the copy re-encrypted
 * `Pulumi.<stack>.yaml`, and git holds it.
 */
export const freezeStack = (pulumi: Pulumi, cwd: string, source: string, stack: string, now = new Date()): Frozen => {
    const version = cloudVersion(pulumi, cwd, source)
    const tags: Record<string, string> = JSON.parse(must(pulumi(['stack', 'tag', 'ls', '--json', '-s', source], { backend: 'cloud', cwd }), `reading the tags of ${source}`) || '{}')
    const recorded = tags[MOVED_TAG]
    if (recorded === undefined) {
        const differences = copyDifferences(pulumi, cwd, source, stack)
        if (differences.length > 0) throw new Error(`${source} was deployed after the copy, which it no longer equals:\n  ${differences.join('\n  ')}\nRemove the copy with \`pulumi stack rm --force -s ${stack}\` against the target, restore Pulumi.${stack}.yaml, and migrate again.`)
        if (cloudVersion(pulumi, cwd, source) !== version) throw new Error(`${source} was deployed while it was being frozen; freeze again.`)
        must(pulumi(['stack', 'tag', 'set', MOVED_TAG, `version ${version} at ${now.toISOString()}`, '-s', source], { backend: 'cloud', cwd }), `tagging ${source}`)
        return { state: 'tagged', version }
    }
    const [, at, when] = /^version (\d+) at (\S+)$/.exec(recorded) ?? []
    if (at === undefined) throw new Error(`${source} is tagged ${MOVED_TAG}=${recorded}, which is not \`version <n> at <time>\``)
    return Number(at) === version ? { state: 'unchanged', version, at: when } : { state: 'deployed', version: Number(at), at: when, now: version }
}
