import { describe, expect, test } from 'bun:test'
import { rewriteWorkflow } from './workflows'

const workflow = (steps: string, extra = '') => `name: Deploy
on: push
${extra}jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
${steps}
`

describe('a workflow logging in to Pulumi Cloud', () => {
    test('one token: the step reads the backend URL secret instead', () => {
        const r = rewriteWorkflow(workflow(`      - uses: pulumi/actions@v6
        with:
          command: up
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}`))
        expect(r.text).toContain('          PULUMI_BACKEND_URL: ${{ secrets.PULUMI_BACKEND_URL }}')
        expect(r.text).not.toContain('PULUMI_ACCESS_TOKEN')
        expect(r.secrets).toEqual(['PULUMI_BACKEND_URL'])
        expect(r.unresolved).toEqual([])
    })

    test('a token per environment, picked at run time, keeps its choice', () => {
        const r = rewriteWorkflow(workflow(`      - run: echo "PULUMI_ACCESS_TOKEN_VAR=PULUMI_ACCESS_TOKEN_\${STAGE^^}" >> "$GITHUB_ENV"
      - uses: pulumi/actions@v6
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets[env.PULUMI_ACCESS_TOKEN_VAR] }}
      - run: pulumi stack output -s prod
        env:
          PULUMI_ACCESS_TOKEN: \${{ github.ref == 'refs/heads/release' && secrets.PULUMI_ACCESS_TOKEN_PROD || secrets.PULUMI_ACCESS_TOKEN_DEV }}`))
        expect(r.text).toContain('echo "PULUMI_BACKEND_URL_VAR=PULUMI_BACKEND_URL_${STAGE^^}"')
        expect(r.text).toContain('PULUMI_BACKEND_URL: ${{ secrets[env.PULUMI_BACKEND_URL_VAR] }}')
        expect(r.text).toContain("secrets.PULUMI_BACKEND_URL_PROD || secrets.PULUMI_BACKEND_URL_DEV")
        expect(r.secrets).toEqual(['PULUMI_BACKEND_URL_${STAGE^^}', 'PULUMI_BACKEND_URL_DEV', 'PULUMI_BACKEND_URL_PROD'])
        expect(r.changes.map(c => c.line)).toEqual([7, 10, 13])
    })

    test('a list of secret names handed to a loader names the URL instead', () => {
        const r = rewriteWorkflow(workflow(`      - uses: ./.github/actions/load
        with:
          names: DEPLOY_ROLE,PULUMI_ACCESS_TOKEN`))
        expect(r.text).toContain('names: DEPLOY_ROLE,PULUMI_BACKEND_URL')
        expect(r.secrets).toEqual(['PULUMI_BACKEND_URL'])
    })

    test('a name that only starts the same is left', () => {
        const yaml = workflow('      - run: echo $MY_PULUMI_ACCESS_TOKEN_COPY')
        expect(rewriteWorkflow(yaml).text).toBe(yaml)
    })

    test('a workflow running Pulumi without naming the token is reported', () => {
        expect(rewriteWorkflow(workflow('      - run: pulumi preview -s dev')).unresolved.map(u => u.reason))
            .toEqual(['the workflow runs Pulumi but never names the token; give its Pulumi steps PULUMI_BACKEND_URL'])
        expect(rewriteWorkflow(workflow('      - run: npm test')).unresolved).toEqual([])
    })

    test('a workflow already rewritten is left, and not reported', () => {
        const once = rewriteWorkflow(workflow(`      - uses: pulumi/actions@v6
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}`)).text
        const again = rewriteWorkflow(once)
        expect([again.text, again.changes, again.unresolved]).toEqual([once, [], []])
        expect(again.secrets).toEqual(['PULUMI_BACKEND_URL'])
    })
})

describe('jobs that can run one stack twice at once', () => {
    const steps = `      - run: pulumi up --yes -s dev`
    test('a job running pulumi with no group is reported', () => {
        expect(rewriteWorkflow(workflow(steps)).unserialized).toEqual(['deploy'])
    })
    test('a workflow-wide group covers it', () => {
        expect(rewriteWorkflow(workflow(steps, 'concurrency:\n  group: deploy-${{ github.ref }}\n')).unserialized).toEqual([])
    })
    test('a job without pulumi is not', () => {
        expect(rewriteWorkflow(workflow('      - run: npm test')).unserialized).toEqual([])
    })
})

describe('a hosted runner opening the state database', () => {
    const uses = 'acme/infra/.github/actions/open-state-db@v1'
    const credentials = `      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
`

    test('the step goes right before the first Pulumi step, after the credentials', () => {
        const r = rewriteWorkflow(workflow(`      - uses: actions/checkout@v4
${credentials}      - run: npm ci
      - uses: pulumi/actions@v6
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}
      - run: pulumi stack output -s dev`), { stateAction: uses })
        expect(r.text).toContain(`      - run: npm ci\n      - uses: ${uses}\n        with:\n          pulumi-cloud-tokens: |\n            PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}\n      - uses: pulumi/actions@v6`)
        expect(r.text.split(uses).length).toBe(2)
        expect(r.changes.map(c => [c.line, c.to])).toEqual([[12, `- uses: ${uses}`], [18, 'PULUMI_BACKEND_URL: ${{ secrets.PULUMI_BACKEND_URL }}']])
        expect(r.text.split('\n')[11].trim()).toBe(`- uses: ${uses}`)
        expect(r.unresolved).toEqual([])
    })

    test('each job running Pulumi gets its own; a job not running it gets none', () => {
        const yaml = `on: push
env:
  AWS_ROLE_ARN: arn:aws:iam::123456789012:role/deploy
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  dev:
    runs-on: ubuntu-latest
    steps:
      - run: pulumi up --yes -s dev
  prod:
    runs-on: ubuntu-latest
    steps:
      - run: pulumi up --yes -s prod
`
        const r = rewriteWorkflow(yaml, { stateAction: uses })
        expect(r.changes.filter(c => c.to.endsWith(uses)).map(c => c.line)).toEqual([12, 17])
        expect(r.text.split('\n')[11].trim()).toBe(`- uses: ${uses}`)
        expect(r.text.split('\n')[16].trim()).toBe(`- uses: ${uses}`)
        expect(r.unresolved.filter(u => u.text !== 'PULUMI_ACCESS_TOKEN')).toEqual([])
    })

    test('a local action that runs Pulumi counts as a Pulumi step', () => {
        const r = rewriteWorkflow(workflow(`${credentials}      - uses: ./.github/actions/deploy
        with:
          stack: dev`), { stateAction: uses, pulumiActions: ['./.github/actions/deploy'] })
        expect(r.text).toContain(`      - uses: ${uses}\n      - uses: ./.github/actions/deploy`)
    })

    test('without credentials before the Pulumi step the job is reported', () => {
        const r = rewriteWorkflow(workflow(`      - run: pulumi preview -s dev
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}
${credentials}`), { stateAction: uses })
        expect(r.unresolved).toEqual([{ line: 7, text: 'deploy', reason: 'no AWS credentials are set before its first Pulumi step; the opening step and Pulumi both need them' }])
    })

    test('a rewritten workflow is left as it is', () => {
        const once = rewriteWorkflow(workflow(`${credentials}      - uses: pulumi/actions@v6
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}`), { stateAction: uses })
        const twice = rewriteWorkflow(once.text, { stateAction: uses })
        expect(twice.text).toBe(once.text)
        expect(twice.changes).toEqual([])
        expect(twice.unresolved).toEqual([])
    })

    test('no action, no step', () => {
        const yaml = workflow(`${credentials}      - run: pulumi up --yes -s dev
        env:
          PULUMI_BACKEND_URL: \${{ secrets.PULUMI_BACKEND_URL }}`)
        expect(rewriteWorkflow(yaml).text).toBe(yaml)
    })
})

describe('the opening step checking Pulumi Cloud is frozen', () => {
    const uses = 'acme/infra/.github/actions/open-state-db@v1'
    const credentials = `      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
`

    test('it is handed every token the workflow named, under their old names', () => {
        const r = rewriteWorkflow(workflow(`${credentials}      - uses: pulumi/actions@v6
        env:
          PULUMI_ACCESS_TOKEN: \${{ github.ref == 'refs/heads/release' && secrets.PULUMI_ACCESS_TOKEN_PROD || secrets.PULUMI_ACCESS_TOKEN_DEV }}`), { stateAction: uses })
        expect(r.text).toContain(`      - uses: ${uses}
        with:
          pulumi-cloud-tokens: |
            PULUMI_ACCESS_TOKEN_DEV: \${{ secrets.PULUMI_ACCESS_TOKEN_DEV }}
            PULUMI_ACCESS_TOKEN_PROD: \${{ secrets.PULUMI_ACCESS_TOKEN_PROD }}
      - uses: pulumi/actions@v6`)
        expect(r.text).toContain('secrets.PULUMI_BACKEND_URL_PROD || secrets.PULUMI_BACKEND_URL_DEV')
        expect(r.secrets).toEqual(['PULUMI_BACKEND_URL_DEV', 'PULUMI_BACKEND_URL_PROD'])
        expect(r.changes.map(c => c.line)).toEqual([10, 17])
        expect(r.text.split('\n')[16]).toContain('PULUMI_BACKEND_URL_PROD')
    })

    test('rewriting again keeps the tokens it checks', () => {
        const once = rewriteWorkflow(workflow(`${credentials}      - run: pulumi up --yes -s dev
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}`), { stateAction: uses })
        expect(once.text).toContain('            PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}\n')
        const twice = rewriteWorkflow(once.text, { stateAction: uses })
        expect(twice.text).toBe(once.text)
        expect(twice.changes).toEqual([])
    })

    test('a token named at run time is reported for listing by hand', () => {
        const r = rewriteWorkflow(workflow(`${credentials}      - run: echo "TOKEN=PULUMI_ACCESS_TOKEN_\${STAGE^^}" >> "$GITHUB_ENV"
      - run: pulumi up --yes -s dev`), { stateAction: uses })
        expect(r.text).not.toContain('pulumi-cloud-tokens')
        expect(r.unresolved.map(u => [u.text, u.reason])).toEqual([['PULUMI_ACCESS_TOKEN_${STAGE^^}', 'a token named at run time; list it under pulumi-cloud-tokens so the step can check Pulumi Cloud is frozen']])
    })
})
