import { must, Pulumi } from './pulumi'

/** The Pulumi Cloud stack tag recording the version a stack moved at: `version <n> at <ISO time>`. */
export const MOVED_TAG = 'lambada-state:moved'

/** The latest version of a Pulumi Cloud stack, 0 before its first update. */
export const cloudVersion = (pulumi: Pulumi, cwd: string, source: string): number => {
    const history: { version: number }[] = JSON.parse(must(pulumi(['stack', 'history', '--json', '--page-size', '1', '-s', source], { backend: 'cloud', cwd }), `reading the history of ${source}`) || '[]')
    return Math.max(0, ...history.map(h => h.version))
}

export type Frozen =
    | { state: 'tagged', version: number }
    | { state: 'unchanged', version: number, at: string }
    | { state: 'deployed', version: number, at: string, now: number }

/**
 * Pulumi Cloud cannot make a stack read-only short of team permissions; what keeps deploys off it is
 * that no token logs in, which the opening step checks in CI. The stack stays, with its history, for
 * the way back. Its tag records the version it moved at, so a deploy that lands there later shows.
 */
export const freezeStack = (pulumi: Pulumi, cwd: string, source: string, now = new Date()): Frozen => {
    const version = cloudVersion(pulumi, cwd, source)
    const tags: Record<string, string> = JSON.parse(must(pulumi(['stack', 'tag', 'ls', '--json', '-s', source], { backend: 'cloud', cwd }), `reading the tags of ${source}`) || '{}')
    const recorded = tags[MOVED_TAG]
    if (recorded === undefined) {
        must(pulumi(['stack', 'tag', 'set', MOVED_TAG, `version ${version} at ${now.toISOString()}`, '-s', source], { backend: 'cloud', cwd }), `tagging ${source}`)
        return { state: 'tagged', version }
    }
    const [, at, when] = /^version (\d+) at (\S+)$/.exec(recorded) ?? []
    if (at === undefined) throw new Error(`${source} is tagged ${MOVED_TAG}=${recorded}, which is not \`version <n> at <time>\``)
    return Number(at) === version ? { state: 'unchanged', version, at: when } : { state: 'deployed', version: Number(at), at: when, now: version }
}
