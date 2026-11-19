import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { moveOrder, planRepo, RepoPlan } from './plan'

const roots: string[] = []
const repo = (files: { [path: string]: string }) => {
    const root = mkdtempSync(join(tmpdir(), 'state-migrate-test-'))
    roots.push(root)
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
    }
    return root
}
afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })))

const shop = () => repo({
    'Pulumi.yaml': 'name: shop\nruntime: nodejs\n',
    'Pulumi.dev.yaml': 'config:\n  shop:catalogStack: petstore/catalog/dev\n',
    'Pulumi.prod.yaml': 'secretsprovider: awskms://alias/state\nconfig:\n  shop:catalogStack: petstore/catalog/prod\n',
    'index.ts': "const orders = new StackReference(`petstore/orders/${env}`)\nconst catalog = new StackReference(config.require('catalogStack'))\n",
    'node_modules/dep/index.ts': "new StackReference('petstore/ignored/dev')\n",
    '.claude/worktrees/old/Pulumi.yaml': 'name: shop\n',
    '.claude/worktrees/old/index.ts': "new StackReference('petstore/ignored/dev')\n",
    '.github/workflows/deploy.yml': 'jobs:\n  up:\n    steps:\n      - uses: pulumi/actions@v6\n        env:\n          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN_T }}\n',
    '.github/actions/deploy/action.yml': 'runs:\n  using: composite\n  steps:\n    - run: pulumi up --yes -s dev\n      shell: bash\n',
    '.github/workflows/release.yml': 'jobs:\n  release:\n    steps:\n      - uses: ./.github/actions/deploy\n',
})

describe('planning a repo', () => {
    test('finds its stacks, references and logins, and changes nothing', () => {
        const root = shop()
        const plan = planRepo(root, 'petstore')
        expect(plan.projects).toEqual([{ name: 'shop', dir: '.', stacks: [{ name: 'dev', file: 'Pulumi.dev.yaml', secretsProvider: undefined }, { name: 'prod', file: 'Pulumi.prod.yaml', secretsProvider: 'awskms://alias/state' }] }])
        expect(plan.files.map(f => [f.file, f.changes.length])).toEqual([['index.ts', 1], ['Pulumi.dev.yaml', 1], ['Pulumi.prod.yaml', 1], ['.github/actions/deploy/action.yml', 0], ['.github/workflows/deploy.yml', 2], ['.github/workflows/release.yml', 1]])
        expect(plan.opening).toEqual(['.github/workflows/deploy.yml:4', '.github/workflows/release.yml:4'])
        expect(plan.secrets).toEqual(['PULUMI_BACKEND_URL_T'])
        expect(plan.references).toEqual(['catalog/dev', 'catalog/prod', 'orders/${env}'])
        expect(plan.unserialized).toEqual(['.github/workflows/deploy.yml: up'])
        expect(readFileSync(join(root, 'index.ts'), 'utf8')).toContain('petstore/orders')
    })

    test('with write, makes the changes it reports', () => {
        const root = shop()
        planRepo(root, 'petstore', true)
        expect(readFileSync(join(root, 'index.ts'), 'utf8')).toContain('`organization/orders/${env}`')
        expect(readFileSync(join(root, 'Pulumi.dev.yaml'), 'utf8')).toContain('shop:catalogStack: organization/catalog/dev')
        expect(readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')).toContain('PULUMI_BACKEND_URL: ${{ secrets.PULUMI_BACKEND_URL_T }}')
        expect(planRepo(root, 'petstore').files.flatMap(f => f.changes)).toEqual([])
    })

    test('a name the backend cannot hold is a problem', () => {
        const root = repo({ 'Pulumi.yaml': 'name: pet_shop\n', 'Pulumi.dev.yaml': 'config: {}\n' })
        expect(planRepo(root, 'petstore').problems).toEqual(["project 'pet_shop' holds '_' or '%', which the Postgres backend reads as a wildcard. Rename it before migrating."])
    })
})

describe('the order to move repos in', () => {
    const plan = (root: string, project: string, references: string[]): RepoPlan =>
        ({ root, projects: [{ name: project, dir: '.', stacks: [] }], problems: [], files: [], unserialized: [], secrets: [], references, opening: [] })

    test('a referenced project moves first; one referenced from outside the plan is not waited on', () => {
        expect(moveOrder([plan('/shop', 'shop', ['catalog/dev', 'payments/dev']), plan('/catalog', 'catalog', [])])).toEqual([['/catalog'], ['/shop']])
    })

    test('projects referencing each other move together', () => {
        expect(moveOrder([plan('/a', 'a', ['b/dev']), plan('/b', 'b', ['a/dev']), plan('/c', 'c', ['a/dev'])])).toEqual([['/a', '/b'], ['/c']])
    })
})
