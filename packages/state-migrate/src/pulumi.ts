import { spawnSync } from 'node:child_process'

export const PULUMI_CLOUD = 'https://api.pulumi.com'

export type Result = { code: number, stdout: string, stderr: string }

/** Runs the Pulumi CLI against one backend. The target's URL is read from the environment, never passed as an argument. */
export type Pulumi = (args: string[], options: { backend: Backend, cwd: string, input?: string }) => Result

export type Backend = 'cloud' | 'target'

export const pulumiCli = (targetUrl: string, cloudToken: string | undefined): Pulumi => (args, { backend, cwd, input }) => {
    // The token stays set on the target too: a secret Pulumi Cloud encrypted is decrypted by Pulumi Cloud, also while importing it elsewhere.
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        PULUMI_SKIP_UPDATE_CHECK: '1',
        PULUMI_BACKEND_URL: backend === 'cloud' ? PULUMI_CLOUD : targetUrl,
        ...(cloudToken ? { PULUMI_ACCESS_TOKEN: cloudToken } : {}),
    }
    const r = spawnSync('pulumi', [...args, '--non-interactive'], { cwd, env, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    if (r.error) throw r.error
    return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

export const must = (r: Result, what: string): string => {
    if (r.code !== 0) throw new Error(`${what} failed:\n${(r.stderr || r.stdout).trim().split('\n').slice(-8).join('\n')}`)
    return r.stdout
}

/** The latest version of a Pulumi Cloud stack, 0 before its first update. A DIY backend numbers every update 0. */
export const cloudVersion = (pulumi: Pulumi, cwd: string, source: string): number => {
    const history: { version: number }[] = JSON.parse(must(pulumi(['stack', 'history', '--json', '--page-size', '1', '-s', source], { backend: 'cloud', cwd }), `reading the history of ${source}`) || '[]')
    return Math.max(0, ...history.map(h => h.version))
}
