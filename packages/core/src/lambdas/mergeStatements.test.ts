import { describe, expect, test } from 'bun:test'
import { mergeStatements, resourceStatements } from '.'

type Statement = Parameters<typeof mergeStatements>[0][number]

const allow = (Action: string[], Resource: string, extra: Partial<Statement> = {}): Statement =>
    ({ Effect: 'Allow', Action, Resource, ...extra })

const grants = (statements: Statement[]) =>
    new Set(statements.flatMap(s =>
        [s.Action ?? []].flat().map(a => a.toLowerCase()).flatMap(a =>
            [s.Resource ?? []].flat().map(r => JSON.stringify([s.Effect, a, r, s.Condition ?? null])))))

describe('mergeStatements', () => {
    test('a lambda that publishes to many topics fits the IAM limit of 6144 characters', () => {
        const topics = Array.from({ length: 60 }, (_, i) =>
            allow(['sns:Publish'], `arn:aws:sns:us-east-1:123456789012:topic-${i}-dev-abcdef0`))
        const size = (s: Statement[]) => JSON.stringify({ Version: '2012-10-17', Statement: s }).length

        expect(size(topics)).toBeGreaterThan(6144)
        expect(size(mergeStatements(topics))).toBeLessThan(6144)
    })

    test('the merge grants each action on each resource and nothing more', () => {
        const statements = [
            allow(['dynamodb:GetItem', 'dynamodb:Query'], 'arn:table/a'),
            allow(['dynamodb:Query', 'dynamodb:GetItem'], 'arn:table/a/index/*'),
            allow(['dynamodb:GetItem'], 'arn:table/b'),
            allow(['sns:Publish'], 'arn:topic/a'),
            allow(['sns:Publish'], 'arn:topic/a'),
        ]

        const merged = mergeStatements(statements)

        expect(grants(merged)).toEqual(grants(statements))
        expect(merged).toHaveLength(3)
    })

    test('a statement with a condition does not lend the condition to, or lose it to, another statement', () => {
        const Condition = { StringEquals: { 'aws:SourceAccount': '123456789012' } }
        const statements = [
            allow(['sqs:SendMessage'], 'arn:queue/a', { Condition }),
            allow(['sqs:SendMessage'], 'arn:queue/b'),
        ]

        const merged = mergeStatements(statements)

        expect(grants(merged)).toEqual(grants(statements))
        expect(merged).toHaveLength(2)
    })

    test('a Deny keeps its own statement', () => {
        const statements = [
            allow(['s3:GetObject'], 'arn:bucket/a/*'),
            { Effect: 'Deny', Action: ['s3:GetObject'], Resource: 'arn:bucket/b/*' } as Statement,
        ]

        expect(grants(mergeStatements(statements))).toEqual(grants(statements))
    })

    test('the statements that resources emit keep their grants through the merge', () => {
        const arns = Array.from({ length: 40 }, (_, i) => `arn:aws:sns:us-east-1:123456789012:topic-${i}`)
        const statements = arns.flatMap(arn =>
            resourceStatements({ arn, access: ['sns:Publish'] }, 'fn', 'dev').statements) as Statement[]

        const merged = mergeStatements(statements)

        expect(grants(merged)).toEqual(grants(statements))
        expect(merged).toHaveLength(1)
    })

    test('the same grants in any order give the same document', () => {
        const Condition = { StringEquals: { 'aws:SourceAccount': '1', 'aws:SourceArn': 'a' } }
        const statements = [
            allow(['sqs:SendMessage', 'sqs:GetQueueUrl'], 'arn:queue/b', { Condition }),
            allow(['sqs:GetQueueUrl', 'sqs:SendMessage'], 'arn:queue/a', {
                Condition: { StringEquals: { 'aws:SourceArn': 'a', 'aws:SourceAccount': '1' } },
            }),
            allow(['sns:Publish'], 'arn:topic/z'),
            allow(['s3:GetObject'], 'arn:bucket/a'),
            { Effect: 'Allow', Action: ['sts:AssumeRole'] } as Statement,
        ]
        const shuffled = [statements[3], statements[4], statements[1], statements[2], statements[0]]

        const merged = mergeStatements(statements)

        expect(JSON.stringify(mergeStatements(shuffled))).toBe(JSON.stringify(merged))
        expect(merged).toHaveLength(4)
    })

    test('the same grants split into different statements give the same document', () => {
        const split = [
            allow(['dynamodb:GetItem'], 'arn:table/a'),
            allow(['dynamodb:PutItem'], 'arn:table/a'),
            allow(['dynamodb:GetItem', 'dynamodb:PutItem'], 'arn:table/b'),
        ]
        const joined = [
            { Effect: 'Allow', Action: ['dynamodb:PutItem', 'dynamodb:GetItem'], Resource: ['arn:table/b', 'arn:table/a'] } as Statement,
        ]

        const merged = mergeStatements(split)

        expect(JSON.stringify(merged)).toBe(JSON.stringify(mergeStatements(joined)))
        expect(grants(merged)).toEqual(grants(split))
        expect(merged).toHaveLength(1)
    })

    test('actions that differ only in case are one action', () => {
        const merged = mergeStatements([
            allow(['SNS:Publish'], 'arn:topic/a'),
            allow(['sns:publish'], 'arn:topic/b'),
        ])

        expect(merged).toEqual([{ Effect: 'Allow', Action: ['sns:publish'], Resource: ['arn:topic/a', 'arn:topic/b'] }])
    })

    test('a NotAction statement merges only with one that differs from it in Resource', () => {
        const statements = [
            { Effect: 'Deny', NotAction: ['iam:*'], Resource: 'arn:a' },
            { Effect: 'Deny', NotAction: ['iam:*'], Resource: 'arn:b' },
            { Effect: 'Deny', NotAction: ['s3:*'], Resource: 'arn:a' },
        ] as Statement[]

        expect(mergeStatements(statements)).toEqual([
            { Effect: 'Deny', NotAction: ['iam:*'], Resource: ['arn:a', 'arn:b'] },
            { Effect: 'Deny', NotAction: ['s3:*'], Resource: 'arn:a' },
        ])
    })

    test('a statement without Action does not gain an empty one', () => {
        const statement = { Effect: 'Deny', NotAction: ['iam:*'], Resource: 'arn:any' } as Statement

        const [merged] = mergeStatements([statement])

        expect(merged).toEqual(statement)
        expect('Action' in merged).toBe(false)
    })
})
