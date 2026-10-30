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
