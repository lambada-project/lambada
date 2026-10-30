import type { Change, Unresolved } from './references'

/**
 * Workflows log in to Pulumi Cloud with `PULUMI_ACCESS_TOKEN`. After the move they log in with
 * `PULUMI_BACKEND_URL`, which every `pulumi` command reads, `pulumi/actions` included: its bare
 * `pulumi login` yields to the variable. However a workflow picks its token (one secret, one per
 * environment, a name built at run time, a list handed to a loader), renaming the token's name keeps
 * that choice and moves it to the URL; the secrets it then names must exist.
 */

/** The step that opens the state database to a hosted runner for its job; see `.github/actions/open-state-db`. */
export const STATE_ACTION = 'lambada-project/lambada/.github/actions/open-state-db@state-db-v1'

export type WorkflowOptions = {
    /** What `uses:` names to open the database, or undefined to add no step, as for runners inside its network. */
    stateAction?: string
    /** Local actions, as `./.github/actions/<name>`, that run Pulumi: calling one is running Pulumi. */
    pulumiActions?: string[]
}

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
export const RUNS_PULUMI = /uses:\s*pulumi\/actions@|(^|[\s;&|(])pulumi\s+(up|preview|destroy|refresh|import|cancel|stack|config)\b/m

export const rewriteWorkflow = (yaml: string, options: WorkflowOptions = {}): WorkflowRewrite => {
    // The step goes in first: renaming keeps every line where it is, so both report final line numbers.
    const opened = options.stateAction ? openStateDatabase(yaml, options.stateAction, options.pulumiActions ?? []) : { text: yaml, changes: [], unresolved: [] }
    const changes: Change[] = [...opened.changes]
    const text = opened.text.split('\n').map((line, i) => {
        const to = line.replace(TOKEN, URL)
        if (to !== line) changes.push({ line: i + 1, from: line.trim(), to: to.trim() })
        return to
    }).join('\n')
    changes.sort((a, b) => a.line - b.line)
    const unresolved: Unresolved[] = !/\bPULUMI_(ACCESS_TOKEN|BACKEND_URL)/.test(yaml) && RUNS_PULUMI.test(yaml)
        ? [{ line: 1, text: 'PULUMI_ACCESS_TOKEN', reason: 'the workflow runs Pulumi but never names the token; give its Pulumi steps PULUMI_BACKEND_URL' }]
        : []
    const secrets = new Set<string>()
    for (const m of text.matchAll(/secrets\.(PULUMI_BACKEND_URL\w*)|secrets\[\s*['"](PULUMI_BACKEND_URL\w*)['"]\s*\]/g)) secrets.add(m[1] ?? m[2])
    for (const m of text.matchAll(/\b(PULUMI_BACKEND_URL\w*\$\{[^}]+\}\w*)/g)) secrets.add(m[1])
    for (const m of text.matchAll(/^\s*(?:-\s+)?[\w-]+:\s*([\w,\s]*\bPULUMI_BACKEND_URL\w*[\w,\s]*)$/gm)) for (const name of m[1].split(',').map(s => s.trim())) if (name.startsWith(URL)) secrets.add(name)
    return { text, changes, unresolved: [...unresolved, ...opened.unresolved], secrets: [...secrets].sort(), unserialized: unserializedJobs(text) }
}

type Job = { name: string, start: number, text: string }

/** The jobs under `jobs:`, each with its offset in the text. */
const jobsOf = (yaml: string): Job[] => {
    const jobs = /^jobs:\s*$/m.exec(yaml)
    if (!jobs) return []
    const at = jobs.index + jobs[0].length
    const body = yaml.slice(at)
    const starts = [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)]
    return starts.map((m, i) => ({ name: m[1], start: at + m.index, text: body.slice(m.index, starts[i + 1]?.index ?? body.length) }))
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length
const AWS_CREDENTIALS = /aws-actions\/configure-aws-credentials@|\bAWS_ACCESS_KEY_ID\s*:|\bAWS_ROLE_ARN\s*:|\bAWS_PROFILE\s*:/

/**
 * A hosted runner reaches the state database only once its address is let in. Each job running Pulumi
 * gets the opening step right before its first Pulumi step; the step closes the database after the job.
 */
const openStateDatabase = (yaml: string, uses: string, pulumiActions: string[]): { text: string, changes: Change[], unresolved: Unresolved[] } => {
    const path = uses.split('@')[0]
    const runsPulumi = (step: string) => RUNS_PULUMI.test(step) || pulumiActions.some(a => new RegExp(`uses:\\s*['"]?${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(step))
    const inserts: { offset: number, line: string, job: string, credentials: boolean }[] = []
    const workflowCredentials = AWS_CREDENTIALS.test(yaml.slice(0, /^jobs:/m.exec(yaml)?.index ?? 0))
    for (const job of jobsOf(yaml)) {
        if (job.text.includes(`${path}@`)) continue
        const steps = /^( +)steps:[ \t]*$/m.exec(job.text)
        if (!steps) continue
        const after = job.text.slice(steps.index + steps[0].length)
        const indent = /^( *)- /m.exec(after)?.[1]
        if (indent === undefined) continue
        const starts = [...after.matchAll(new RegExp(`^${indent}- `, 'gm'))]
        const blocks = starts.map((m, i) => ({ offset: m.index, text: after.slice(m.index, starts[i + 1]?.index ?? after.length) }))
        const first = blocks.findIndex(b => runsPulumi(b.text))
        if (first < 0) continue
        const credentials = workflowCredentials || AWS_CREDENTIALS.test(job.text.slice(0, steps.index)) || blocks.slice(0, first).some(b => AWS_CREDENTIALS.test(b.text))
        inserts.push({ offset: job.start + steps.index + steps[0].length + blocks[first].offset, line: `${indent}- uses: ${uses}\n`, job: job.name, credentials })
    }
    let text = yaml
    for (const i of [...inserts].reverse()) text = text.slice(0, i.offset) + i.line + text.slice(i.offset)
    const changes: Change[] = []
    const unresolved: Unresolved[] = []
    let shift = 0
    for (const i of inserts) {
        const line = lineAt(text, i.offset + shift)
        shift += i.line.length
        changes.push({ line, from: '', to: i.line.trim() })
        if (!i.credentials) unresolved.push({ line, text: i.job, reason: 'no AWS credentials are set before its first Pulumi step; the opening step and Pulumi both need them' })
    }
    return { text, changes, unresolved }
}

/**
 * Two runs on one stack of a self-managed backend both see the other's lock and both fail, where Pulumi
 * Cloud queues the second; a `concurrency` group makes GitHub queue it instead.
 */
const unserializedJobs = (yaml: string): string[] => {
    if (/^concurrency:/m.test(yaml)) return []
    return jobsOf(yaml)
        .filter(job => /uses:\s*pulumi\/actions@|\bpulumi\s+(up|destroy|refresh|import|cancel)\b/.test(job.text) && !/^ {4}concurrency:/m.test(job.text))
        .map(job => job.name)
}
