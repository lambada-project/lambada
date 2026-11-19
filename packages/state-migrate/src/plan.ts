import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Change, referenceConfigKeys, rewriteCode, rewriteConfig, Unresolved } from './references'
import { findFiles, findProjects, nameProblem, Project } from './scan'
import { rewriteWorkflow, RUNS_PULUMI, STATE_ACTION } from './workflows'

export type FileReport = { file: string, changes: Change[], unresolved: Unresolved[] }

export type RepoPlan = {
    root: string
    projects: Project[]
    /** Names the Postgres backend cannot hold. */
    problems: string[]
    files: FileReport[]
    /** Workflow jobs running Pulumi without a concurrency group, as `file: job`. */
    unserialized: string[]
    /** The secrets the rewritten workflows read the backend URL from; each must exist before they run. */
    secrets: string[]
    /** Projects this repo's code references, by the name it spells: `<project>/<stack>`. */
    references: string[]
    /** Jobs that open the state database to their runner, as `file: job`. */
    opening: string[]
}

const CODE = (name: string) => /\.(ts|js|mjs|cjs)$/.test(name) && !/\.(test|spec|d)\.[a-z]+$/.test(name)

/**
 * What moving a repo to a self-managed backend changes in it: its stack references, the config values
 * naming them, and its workflows' login. With `write`, the changes are made; the report is the same.
 */
export const planRepo = (root: string, org: string, write = false, stateAction: string | undefined = STATE_ACTION): RepoPlan => {
    const projects = findProjects(root)
    const problems = projects.flatMap(p => [nameProblem('project', p.name), ...p.stacks.map(s => nameProblem('stack', s.name))].filter((x): x is string => !!x))
    const files: FileReport[] = []
    const references = new Set<string>()
    const keep = (file: string, before: string, r: { text: string, changes: Change[], unresolved: Unresolved[] }) => {
        if (r.changes.length + r.unresolved.length === 0) return
        files.push({ file: relative(root, file), changes: r.changes, unresolved: r.unresolved })
        if (write && r.text !== before) writeFileSync(file, r.text)
    }

    const configKeys = new Set<string>()
    for (const file of findFiles(root, CODE)) {
        const source = readFileSync(file, 'utf8')
        if (!source.includes('StackReference') && !source.includes(`${org}/`)) continue
        referenceConfigKeys(source).forEach(k => configKeys.add(k))
        const r = rewriteCode(source, org)
        r.changes.forEach(c => references.add(c.to.split('/').slice(1).join('/')))
        keep(file, source, r)
    }
    for (const project of projects) for (const stack of project.stacks) {
        const file = join(root, stack.file)
        const yaml = readFileSync(file, 'utf8')
        const keys = [...configKeys].flatMap(k => [k, `${project.name}:${k}`])
        const r = rewriteConfig(yaml, org, keys)
        r.changes.forEach(c => references.add(c.to.split('/').slice(1).join('/')))
        keep(file, yaml, r)
    }
    const unserialized: string[] = []
    const opening: string[] = []
    const secrets = new Set<string>()
    const github = join(root, '.github')
    const workflows = existsSync(github) ? findFiles(github, n => /\.ya?ml$/.test(n), 3).filter(f => /\/\.github\/(workflows|actions)\//.test(f)) : []
    const pulumiActions = workflows
        .filter(f => /\/\.github\/actions\/[^/]+\/action\.ya?ml$/.test(f) && RUNS_PULUMI.test(readFileSync(f, 'utf8')))
        .map(f => `./${relative(root, dirname(f))}`)
    for (const file of workflows) {
        const yaml = readFileSync(file, 'utf8')
        const r = rewriteWorkflow(yaml, { stateAction, pulumiActions })
        unserialized.push(...r.unserialized.map(job => `${relative(root, file)}: ${job}`))
        if (stateAction) opening.push(...r.changes.filter(c => c.to.endsWith(stateAction)).map(c => `${relative(root, file)}:${c.line}`))
        r.secrets.forEach(s => secrets.add(s))
        keep(file, yaml, r)
    }
    return { root, projects, problems, files, unserialized, secrets: [...secrets].sort(), references: [...references].sort(), opening }
}

/**
 * The order to move repos in: a stack's references resolve in the backend it lives in, so the projects
 * a repo references move before it, or with it. Repos referencing each other form one group.
 */
export const moveOrder = (plans: RepoPlan[]): string[][] => {
    const owner = new Map(plans.flatMap(p => p.projects.map(project => [project.name, p.root] as const)))
    const needs = new Map(plans.map(p => [p.root, new Set(p.references.map(r => owner.get(r.split('/')[0])).filter((o): o is string => !!o && o !== p.root))]))
    // Strongly connected components (Tarjan), emitted dependencies first.
    const order: string[][] = []
    const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>()
    let next = 0
    const visit = (v: string) => {
        index.set(v, next); low.set(v, next); next++; stack.push(v); on.add(v)
        for (const w of needs.get(v) ?? []) {
            if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)) }
            else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
        }
        if (low.get(v) === index.get(v)) {
            const group: string[] = []
            let w: string
            do { w = stack.pop()!; on.delete(w); group.push(w) } while (w !== v)
            order.push(group.sort())
        }
    }
    for (const p of [...needs.keys()].sort()) if (!index.has(p)) visit(p)
    return order
}
