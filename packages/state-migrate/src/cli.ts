#!/usr/bin/env node
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { migrateStack } from './migrate'
import { moveOrder, planRepo, RepoPlan } from './plan'
import { must, pulumiCli } from './pulumi'

const USAGE = `lambada-state: move Pulumi stacks from Pulumi Cloud to a self-managed backend

  lambada-state plan <repo...>       what each repo holds and what moving it changes; the order to move them in
  lambada-state rewrite <repo>       make those changes: stack references, the config naming them, workflow logins
  lambada-state migrate <repo> --stack <name> --secrets-provider <url>
                                     copy the stack of every project in the repo, and prove each copy

Options:
  --org <name>              the Pulumi Cloud organization (default: the one PULUMI_ACCESS_TOKEN belongs to)

Environment for migrate:
  PULUMI_BACKEND_URL        the target backend, such as postgres://…?sslmode=verify-full. Read from the
                            environment so the password stays out of arguments and ~/.pulumi/credentials.json.
  PULUMI_ACCESS_TOKEN       a Pulumi Cloud token that can read the source stacks
`

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        org: { type: 'string' },
        stack: { type: 'string' },
        'secrets-provider': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    },
})
const [command, ...repos] = positionals

const fail = (message: string): never => {
    console.error(message)
    process.exit(1)
}

const organization = (): string => {
    if (values.org) return values.org
    if (!process.env.PULUMI_ACCESS_TOKEN) return fail('Pass --org, or set PULUMI_ACCESS_TOKEN to read it from Pulumi Cloud.')
    return must(pulumiCli('', process.env.PULUMI_ACCESS_TOKEN)(['whoami'], { backend: 'cloud', cwd: process.cwd() }), 'pulumi whoami').trim()
}

const print = (plan: RepoPlan) => {
    console.log(`\n${plan.root}`)
    for (const p of plan.projects) console.log(`  project ${p.name} (${p.dir}): ${p.stacks.map(s => `${s.name}${s.secretsProvider ? ` [${s.secretsProvider.split('://')[0]}]` : ''}`).join(', ') || 'no stacks'}`)
    for (const problem of plan.problems) console.log(`  ✗ ${problem}`)
    for (const f of plan.files) {
        for (const c of f.changes) console.log(`  ~ ${f.file}:${c.line}  ${c.from ? `${c.from} → ` : '+ '}${c.to}`)
        for (const u of f.unresolved) console.log(`  ? ${f.file}:${u.line}  ${u.text}: ${u.reason}`)
    }
    for (const job of plan.unserialized) console.log(`  ? ${job}: runs Pulumi with no concurrency group. Two runs on one stack both fail on the backend's lock; add one.`)
    if (plan.secrets.length) console.log(`  workflows read the backend URL from: ${plan.secrets.join(', ')}; create these secrets before merging`)
    if (plan.references.length) console.log(`  references: ${plan.references.join(', ')}`)
}

if (values.help || !command) {
    console.log(USAGE)
} else if (command === 'plan' || command === 'rewrite') {
    if (repos.length === 0) fail(USAGE)
    if (command === 'rewrite' && repos.length !== 1) fail('rewrite takes one repo.')
    const org = organization()
    const plans = repos.map(r => planRepo(resolve(r), org, command === 'rewrite'))
    plans.forEach(print)
    if (command === 'plan' && plans.length > 1) {
        console.log('\nMove in this order (a group moves together):')
        moveOrder(plans).forEach((group, i) => console.log(`  ${i + 1}. ${group.join(' + ')}`))
    }
    if (plans.some(p => p.problems.length)) process.exitCode = 1
} else if (command === 'migrate') {
    const [repo] = repos
    const { stack, 'secrets-provider': secretsProvider } = values
    if (!repo || !stack || !secretsProvider) fail(USAGE)
    const targetUrl = process.env.PULUMI_BACKEND_URL ?? fail('Set PULUMI_BACKEND_URL to the target backend.')
    if (targetUrl.startsWith('https://api.pulumi.com')) fail('PULUMI_BACKEND_URL names Pulumi Cloud; set it to the target backend.')
    const org = organization()
    const plan = planRepo(resolve(repo!), org)
    if (plan.problems.length) fail(plan.problems.join('\n'))
    const pulumi = pulumiCli(targetUrl, process.env.PULUMI_ACCESS_TOKEN)
    const projects = plan.projects.filter(p => p.stacks.some(s => s.name === stack))
    if (projects.length === 0) fail(`No project in ${repo} has a Pulumi.${stack}.yaml; its stacks are named by those files.`)
    for (const project of projects) {
        migrateStack({ pulumi, cwd: join(plan.root, project.dir), org, project: project.name, stack: stack!, secretsProvider: secretsProvider!, log: console.log })
    }
    console.log(`\nNext: make the Pulumi Cloud stacks read-only, run \`lambada-state rewrite ${repo}\`, and open the PR; its preview should show no changes.`)
} else {
    fail(USAGE)
}
