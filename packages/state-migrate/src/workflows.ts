import type { Change, Unresolved } from './references'

/**
 * Workflows log in to Pulumi Cloud with `PULUMI_ACCESS_TOKEN`. After the move they log in with
 * `PULUMI_BACKEND_URL`, which every `pulumi` command reads, `pulumi/actions` included: its bare
 * `pulumi login` yields to the variable. However a workflow picks its token (one secret, one per
 * environment, a name built at run time, a list handed to a loader), renaming the token's name keeps
 * that choice and moves it to the URL; the secrets it then names must exist.
 */

export type WorkflowRewrite = {
    text: string
    changes: Change[]
    unresolved: Unresolved[]
    /** The secrets the rewritten workflow reads, by the names it spells. */
    secrets: string[]
    /** Jobs running Pulumi with no `concurrency` group of their own or of the workflow. */
    unserialized: string[]
}

const TOKEN = /\bPULUMI_ACCESS_TOKEN/g
const URL = 'PULUMI_BACKEND_URL'
const RUNS_PULUMI = /uses:\s*pulumi\/actions@|(^|[\s;&|(])pulumi\s+(up|preview|destroy|refresh|import|cancel|stack|config)\b/m

export const rewriteWorkflow = (yaml: string): WorkflowRewrite => {
    const changes: Change[] = []
    const lines = yaml.split('\n').map((line, i) => {
        const to = line.replace(TOKEN, URL)
        if (to !== line) changes.push({ line: i + 1, from: line.trim(), to: to.trim() })
        return to
    })
    const text = lines.join('\n')
    const unresolved: Unresolved[] = !/\bPULUMI_(ACCESS_TOKEN|BACKEND_URL)/.test(yaml) && RUNS_PULUMI.test(yaml)
        ? [{ line: 1, text: 'PULUMI_ACCESS_TOKEN', reason: 'the workflow runs Pulumi but never names the token; give its Pulumi steps PULUMI_BACKEND_URL' }]
        : []
    const secrets = new Set<string>()
    for (const m of text.matchAll(/secrets\.(PULUMI_BACKEND_URL\w*)|secrets\[\s*['"](PULUMI_BACKEND_URL\w*)['"]\s*\]/g)) secrets.add(m[1] ?? m[2])
    for (const m of text.matchAll(/\b(PULUMI_BACKEND_URL\w*\$\{[^}]+\}\w*)/g)) secrets.add(m[1])
    for (const m of text.matchAll(/^\s*(?:-\s+)?[\w-]+:\s*([\w,\s]*\bPULUMI_BACKEND_URL\w*[\w,\s]*)$/gm)) for (const name of m[1].split(',').map(s => s.trim())) if (name.startsWith(URL)) secrets.add(name)
    return { text, changes, unresolved, secrets: [...secrets].sort(), unserialized: unserializedJobs(text) }
}

/**
 * Two runs on one stack of a self-managed backend both see the other's lock and both fail, where Pulumi
 * Cloud queues the second; a `concurrency` group makes GitHub queue it instead.
 */
const unserializedJobs = (yaml: string): string[] => {
    if (/^concurrency:/m.test(yaml)) return []
    const jobs = /^jobs:\s*$/m.exec(yaml)
    if (!jobs) return []
    const body = yaml.slice(jobs.index + jobs[0].length)
    const starts = [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)]
    return starts
        .map((m, i) => ({ name: m[1], text: body.slice(m.index, starts[i + 1]?.index ?? body.length) }))
        .filter(job => /uses:\s*pulumi\/actions@|\bpulumi\s+(up|destroy|refresh|import|cancel)\b/.test(job.text) && !/^ {4}concurrency:/m.test(job.text))
        .map(job => job.name)
}
