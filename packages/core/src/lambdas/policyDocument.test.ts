import { describe, expect, test } from 'bun:test'
import { logsStatement, MANAGED_POLICY_LIMIT, policyDocument } from '.'

describe('policyDocument', () => {
    const topic = (i: number) => ({ Effect: 'Allow' as const, Action: [`sns:Publish${i}`], Resource: `arn:aws:sns:us-east-1:123456789012:topic-${i}` })

    test('states the logs statement and the grants, merged', () => {
        expect(policyDocument('p', [topic(1)]).Statement).toEqual([
            logsStatement,
            { Action: ['sns:publish1'], Effect: 'Allow', Resource: 'arn:aws:sns:us-east-1:123456789012:topic-1' },
        ] as never)
    })

    test('names the policy and its size when IAM would refuse it', () => {
        const statements = Array.from({ length: 120 }, (_, i) => topic(i))

        expect(JSON.stringify({ Statement: statements }).length).toBeGreaterThan(MANAGED_POLICY_LIMIT)
        expect(() => policyDocument('fn-prod-policy', statements)).toThrow(/^fn-prod-policy is \d+ characters, and IAM allows 6144/)
    })
})
