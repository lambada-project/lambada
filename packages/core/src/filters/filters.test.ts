import { describe, expect, test } from 'bun:test'
import verdicts from './awsVerdicts.json'
import deliveries from './snsDeliveries.json'
import { AttributePolicy, BodyPolicy, StringAttributePolicy } from '.'
import { filterArgs } from '../messaging/createSubscription'
import { eventSourceMappingArgs, LambdaQueueHandler } from '../queue/createQueueHandler'

const queueHandler = (filter: LambdaQueueHandler['filter']) =>
    ({ name: 's', queue: 'jobs', callback: { functionFolder: '.', handler: 'index.main' }, resources: {} as never, filter }) as LambdaQueueHandler

const targets = {
    'sns:attributes': (policy: unknown) => filterArgs('s', { attributes: policy } as never).filterPolicy,
    'sns:body': (policy: unknown) => filterArgs('s', { body: policy } as never).filterPolicy,
    'sqs:body': (policy: unknown) => eventSourceMappingArgs(queueHandler({ body: policy } as never)).filterCriteria?.filters[0].pattern,
    'sqs:attributes': (policy: unknown) => eventSourceMappingArgs(queueHandler({ attributes: policy } as never)).filterCriteria?.filters[0].pattern,
}
type Target = keyof typeof targets

/** What each target was sent for a policy, as the oracle wrapped it. */
const sent: { [T in Target]: (policy: Record<string, unknown>) => unknown } = {
    'sns:attributes': policy => policy,
    'sns:body': policy => policy,
    'sqs:body': policy => ({ body: policy }),
    'sqs:attributes': policy => ({ messageAttributes: Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, Array.isArray(v) ? { stringValue: v } : v])) }),
}

const cases = verdicts.flatMap(v => (Object.keys(targets) as Target[]).map(target => {
    let written: unknown
    try { written = targets[target](v.policy) } catch { written = undefined }
    return { target, name: v.name, policy: v.policy as Record<string, unknown>, aws: (v as Record<string, unknown>)[target], written }
})).filter(c => c.aws !== undefined)

describe('a filter, against what SNS and Lambda said of it', () => {
    test('is never written where AWS rejects it, or fails on it', () => {
        expect(cases.filter(c => c.aws !== 'accepts' && c.written !== undefined).map(c => `${c.target} ${c.name}`)).toEqual([])
    })

    test('is written as AWS accepted it', () => {
        expect(cases.filter(c => c.aws === 'accepts' && c.written !== undefined && c.written !== JSON.stringify(sent[c.target](c.policy)))
            .map(c => `${c.target} ${c.name}`)).toEqual([])
    })

    test('is refused where AWS takes it only when it could never match, or matches everything', () => {
        expect(cases.filter(c => c.aws === 'accepts' && c.written === undefined).map(c => `${c.target} ${c.name}`)).toEqual([
            'sqs:attributes number',
            'sqs:attributes boolean',
            'sqs:attributes null',
            'sqs:attributes butNumber',
            'sqs:attributes butNumbers',
            'sqs:attributes numEquals',
            'sqs:attributes numLower',
            'sqs:attributes numUpper',
            'sqs:attributes numRange',
            'sqs:attributes nested',
            'sns:attributes emptyPolicy',
            'sns:body emptyPolicy',
            'sqs:attributes nestedLeafKeys5',
            'sqs:attributes nestedLeafKeys6',
            'sqs:attributes depth3x50',
            'sqs:attributes depth3x51',
            'sqs:attributes numEqMax',
            'sqs:attributes numEqOver',
            'sqs:attributes numEqMin',
            'sqs:attributes numEqUnder',
            'sqs:attributes num5Decimals',
            'sqs:attributes num6Decimals',
            'sqs:attributes numValueOver',
            'sqs:attributes butNumberOver',
        ])
    })
})

test('takes only the conditions the grammar holds', () => {
    const typeOnly = () => {
        // @ts-expect-error
        ({ k: [] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ k: [{ prefix: 'a', suffix: 'b' }] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ k: [{ 'anything-but': ['a', 1] }] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ k: [{ numeric: ['<', 5, '>', 0] }] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ k: [{ numeric: [1] }] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ k: [{ cidr: 'nope' }] }) satisfies AttributePolicy;
        // @ts-expect-error
        ({ $or: [{ k: ['a'] }] }) satisfies BodyPolicy;
        // @ts-expect-error
        ({ k: [1] }) satisfies StringAttributePolicy;
        // @ts-expect-error
        ({ k: [{ numeric: ['>', 0] }] }) satisfies StringAttributePolicy;
        ({ k: [{ wildcard: 'a*b' }, { 'anything-but': { 'equals-ignore-case': ['a', 'b'] } }], $or: [{ j: ['a'] }, { i: [{ exists: false }] }] }) satisfies AttributePolicy;
        ({ order: { amount: [{ numeric: ['>', 0, '<=', 5] }] } }) satisfies BodyPolicy
    }
    expect(typeOnly).toBeFunction()
})

test('refuses a numeric range that holds nothing', () => {
    expect(() => filterArgs('onOrder', { body: { amount: [{ numeric: ['>', 5, '<', 1] }] } }))
        .toThrow('onOrder filters amount {"numeric":[">",5,"<",1]}, which a filter policy does not take there')
})

describe('a filter, against what SNS delivered by it', () => {
    test('is written as the policy SNS delivered by, escaped once', () => {
        const written = deliveries.filter(d => {
            const policy = { value: d.condition }
            const filter = d.scope === 'attributes' ? { attributes: policy } : { body: policy }
            return filterArgs('s', filter as never).filterPolicy !== JSON.stringify(policy)
        })
        expect(written).toEqual([])
    })
})
