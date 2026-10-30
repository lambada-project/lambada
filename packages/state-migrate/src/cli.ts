#!/usr/bin/env node
import { statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { freezeStack } from './freeze'
import { migrateStack } from './migrate'
import { moveOrder, planRepo, RepoPlan } from './plan'
import { must, pulumiCli } from './pulumi'
import { STATE_ACTION } from './workflows'

const USAGE = `lambada-state: move Pulumi stacks from Pulumi Cloud to a self-managed backend

  lambada-state plan <repo...>       what each repo holds and what moving it changes; the order to move them in
  lambada-state rewrite <repo>       make those changes: stack references, the config naming them, workflow logins
  lambada-state migrate <repo> --stack <name> --secrets-provider <url>
                                     copy the stack of every project in the repo, and prove each copy
  lambada-state freeze <repo> --stack <name>
                                     tag each Pulumi Cloud stack with the version it moved at; run again,
                                     report any deploy that landed on it since. Nothing is deleted.

Options:
  --stack <name>            migrate, freeze: the stack to copy, in every project of the repo that has Pulumi.<name>.yaml
  --secrets-provider <url>  migrate: how the copy encrypts, such as awskms://alias/pulumi-state?region=us-east-1
  --org <name>              the Pulumi Cloud organization (default: the one PULUMI_ACCESS_TOKEN belongs to)
  --state-action <uses>     plan, rewrite: the step that opens the database to a hosted runner, put before each
                            job's first Pulumi step (default: ${STATE_ACTION});
                            none for runners inside the database's network

Output:
  ~ file:line  a change rewrite makes
  ? file:line  something to change by hand, with the reason
  ✗            a problem that stops the move, such as a name the backend cannot hold

Exit status: 1 when plan finds a problem, or a command fails or refuses; 0 otherwise.
Needs the pulumi CLI on PATH and Node 22 or later.

Freezing: Pulumi Cloud cannot make a stack read-only, so the move holds once no token can deploy there.
The step rewrite adds checks the tokens the workflows used, and refuses to deploy while one still logs
in to Pulumi Cloud: revoke each, or remove its secret from the repo. Revoke personal tokens too.

Environment for migrate and freeze:
  PULUMI_BACKEND_URL        the target backend, such as postgres://…?sslmode=verify-full. Read from the
                            environment so the password stays out of arguments and ~/.pulumi/credentials.json.
  PULUMI_ACCESS_TOKEN       a Pulumi Cloud token that can read the source stacks, and tag them to freeze them
`

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        org: { type: 'string' },
        stack: { type: 'string' },
        'secrets-provider': { type: 'string' },
        'state-action': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    },
})
const [command, ...repos] = positionals

const fail = (message: string): never => {
    console.error(message)
    process.exit(1)
}

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false

const organization = (): string => {
    if (values.org) return values.org
    if (!process.env.PULUMI_ACCESS_TOKEN) return fail('Pass --org, or set PULUMI_ACCESS_TOKEN to read it from Pulumi Cloud.')
    try {
        return must(pulumiCli('', process.env.PULUMI_ACCESS_TOKEN)(['whoami'], { backend: 'cloud', cwd: process.cwd() }), 'pulumi whoami').trim()
    } catch (error) {
        return fail((error as Error).message)
    }
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
    if (plan.opening.length) console.log(`  jobs opening the database: ${plan.opening.length}. The role each assumes needs ec2:DescribeSecurityGroups, ec2:DescribeSecurityGroupRules, and ec2:AuthorizeSecurityGroupIngress and ec2:RevokeSecurityGroupIngress on the database's group, besides kms:Decrypt on the secrets provider's key`)
}

for (const repo of repos.filter(r => !isDirectory(r))) fail(`${repo} is not a directory.`)

if (values.help || !command) {
    console.log(USAGE)
} else if (command === 'plan' || command === 'rewrite') {
    if (repos.length === 0) fail(USAGE)
    if (command === 'rewrite' && repos.length !== 1) fail('rewrite takes one repo.')
    const org = organization()
    const stateAction = values['state-action'] === 'none' ? undefined : values['state-action'] ?? STATE_ACTION
    const plans = repos.map(r => planRepo(resolve(r), org, command === 'rewrite', stateAction))
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
        try {
            migrateStack({ pulumi, cwd: join(plan.root, project.dir), org, project: project.name, stack: stack!, secretsProvider: secretsProvider!, log: console.log })
        } catch (error) {
            fail(`${project.name}: ${(error as Error).message}`)
        }
    }
    console.log(`\nNext: run \`lambada-state freeze ${repo} --stack ${stack}\`, then \`lambada-state rewrite ${repo}\`, and open the PR; its preview should show no changes.`)
} else if (command === 'freeze') {
    const [repo] = repos
    const { stack } = values
    if (!repo || !stack) fail(USAGE)
    const org = organization()
    const plan = planRepo(resolve(repo!), org)
    const pulumi = pulumiCli('', process.env.PULUMI_ACCESS_TOKEN)
    const projects = plan.projects.filter(p => p.stacks.some(s => s.name === stack))
    if (projects.length === 0) fail(`No project in ${repo} has a Pulumi.${stack}.yaml; its stacks are named by those files.`)
    for (const project of projects) {
        const source = `${org}/${project.name}/${stack}`
        try {
            const frozen = freezeStack(pulumi, join(plan.root, project.dir), source)
            if (frozen.state === 'tagged') console.log(`${source}: frozen at version ${frozen.version}`)
            else if (frozen.state === 'unchanged') console.log(`${source}: unchanged since it moved at version ${frozen.version}, ${frozen.at}`)
            else {
                console.log(`✗ ${source}: deployed on Pulumi Cloud after the move, version ${frozen.version} → ${frozen.now}. Its resources may differ from the moved stack's: find that update in its history, stop what ran it, then \`pulumi refresh\` the moved stack.`)
                process.exitCode = 1
            }
        } catch (error) {
            fail(`${project.name}: ${(error as Error).message}`)
        }
    }
} else {
    fail(USAGE)
}
