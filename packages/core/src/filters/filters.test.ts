import { describe, expect, test } from 'bun:test'
import verdicts from './awsVerdicts.json'
import deliveries from './snsDeliveries.json'
import lambdaDeliveries from './lambdaDeliveries.json'
import { AttributePolicy, BodyPolicy, operatorNames, StringAttributePolicy } from '.'
import { filterArgs } from '../messaging/createSubscription'
import { eventSourceMappingArgs, LambdaQueueHandler } from '../queue/createQueueHandler'

const queueHandler = (filter: LambdaQueueHandler['filter']) =>
    ({ name: 's', queue: 'jobs', callback: { functionFolder: '.', handler: 'index.main' }, resources: {} as never, filter }) as LambdaQueueHandler

const targets = {
    'sns:attributes': (policy: unknown) => filterArgs('s', { attributes: policy } as never).filterPolicy,
    'sns:body': (policy: unknown) => filterArgs('s', { body: policy } as never).filterPolicy,
    'sqs:body': (policy: unknown) => eventSourceMappingArgs(queueHandler({ body: policy } as never)).filterCriteria?.filters[0].pattern,
    'sqs:attributes': (policy: unknown) => eventSourceMappingArgs(queueHandler(sent['sqs:attributes'](policy as Record<string, unknown>) as never)).filterCriteria?.filters[0].pattern,
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

const sns = (filter: unknown) => () => filterArgs('onOrder', filter as never)
const queue = (pattern: unknown) => () => eventSourceMappingArgs(queueHandler(pattern as never))

test.each<[string, () => unknown, string]>([
    ['a queue pattern with nothing to match', queue({}), 'a pattern takes a body, messageAttributes or $or of two patterns or more'],
    ['a queue $or of one pattern', queue({ $or: [{ body: { k: ['a'] } }] }), '$or of two patterns or more'],
    ['a queue $or branch Lambda rejects', queue({ $or: [{ body: { k: ['a'] } }, { body: { k: [] } }] }), 's filters k []'],
    ['a queue key Lambda does not take', queue({ body: { b: ['y'] }, attributes: { a: ['x'] } }), 'a pattern takes a body, messageAttributes or $or'],
    ['an attribute held as a bare list', queue({ messageAttributes: { kind: ['urgent'] } }), 'messageAttributes.kind by ["urgent"]; an attribute is matched by its stringValue'],
    ['an attribute held beside its dataType', queue({ messageAttributes: { kind: { stringValue: ['a'], dataType: ['String'] } } }), 'an attribute is matched by its stringValue'],
    ['both SNS scopes, rather than drop one', sns({ attributes: { a: ['x'] }, body: { b: ['y'] } }), 'a filter takes attributes or body, one of them'],
    ['an SNS scope misspelled', sns({ attribute: { a: ['x'] } }), 'a filter takes attributes or body, one of them'],
    ...['toString', 'constructor', 'hasOwnProperty'].map(op => [`${op}, a key every object inherits, as an operator`, sns({ attributes: { k: [{ [op]: 'x' }] } }), `onOrder filters k {"${op}":"x"}`] as [string, () => unknown, string]),
    ['a range whose inclusive bottom is its top', sns({ body: { amount: [{ numeric: ['>=', 5, '<=', 5] }] } }), 'onOrder filters amount'],
    ['a range whose bottom is its top', sns({ body: { amount: [{ numeric: ['>', 5, '<=', 5] }] } }), 'onOrder filters amount'],
    ['a range that holds nothing', sns({ body: { amount: [{ numeric: ['>', 5, '<', 1] }] } }), 'onOrder filters amount {"numeric":[">",5,"<",1]}, which a filter policy does not take there'],
    ['NaN, which JSON writes as null', sns({ attributes: { amount: [NaN] } }), 'onOrder filters amount null'],
    ['Infinity, which JSON writes as null', sns({ body: { amount: [{ 'anything-but': Infinity }] } }), 'onOrder filters amount'],
    ['$or as a field', sns({ body: { $or: ['a'] } }), 'onOrder filters $or ["a"]'],
    ['$or of one branch', sns({ body: { $or: [{ a: ['1'] }] } }), 'onOrder filters $or'],
])('refuses %s', (_, write, message) => expect(write).toThrow(message))

test('takes one SNS scope, in its type', () => {
    const typeOnly = () => {
        // @ts-expect-error
        filterArgs('onOrder', { attributes: { a: ['x'] }, body: { b: ['y'] } })
    }
    expect(typeOnly).toBeFunction()
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

describe('a queue handler filter, against what Lambda delivered by it', () => {
    test('declares every pattern Lambda delivered by as itself, and writes it unchanged', () => {
        expect(lambdaDeliveries.filter(d => eventSourceMappingArgs(queueHandler(JSON.parse(d.pattern))).filterCriteria?.filters[0].pattern !== d.pattern)).toEqual([])
    })
})

/** The operators a policy's conditions hold, anything-but's exclusions named under it; an operator's own argument is not searched. */
const operatorsIn = (v: unknown, under?: string): string[] =>
    typeof v !== 'object' || v === null ? []
    : Array.isArray(v) ? v.flatMap(x => operatorsIn(x, under))
    : Object.entries(v).flatMap(([k, x]) =>
        under === 'anything-but' ? [`anything-but.${k}`]
        : operatorNames().includes(k) ? [k, ...(k === 'anything-but' ? operatorsIn(x, k) : [])]
        : operatorsIn(x))

/** The operators of every condition that delivered one message and held back another. */
const separating = (groups: Map<string, boolean[]>) =>
    new Set([...groups].filter(([, delivered]) => delivered.includes(true) && delivered.includes(false)).flatMap(([condition]) => operatorsIn(JSON.parse(condition))))
const grouped = <T>(rows: T[], key: (row: T) => string, delivered: (row: T) => boolean) =>
    rows.reduce((m, r) => m.set(key(r), [...(m.get(key(r)) ?? []), delivered(r)]), new Map<string, boolean[]>())

test('every operator lambada writes has delivered a message and held one back, on each service', () => {
    const untried = (seen: Set<string>) => operatorNames().filter(op => !seen.has(op))
    expect(untried(separating(grouped(deliveries, d => JSON.stringify(d.condition), d => d.delivered)))).toEqual([])
    expect(untried(separating(grouped(lambdaDeliveries, d => d.pattern, d => d.delivered)))).toEqual([])
})

test('takes a body as text or JSON, with or beside its attributes, and the case-insensitive and listed forms', () => {
    const typeOnly = () => {
        queueHandler({ body: [{ prefix: 'ERROR' }] })
        queueHandler({ body: { type: ['order.created'] }, messageAttributes: { kind: { stringValue: ['urgent'] } } })
        queueHandler({ body: { name: [{ prefix: { 'equals-ignore-case': 'ab' } }, { 'anything-but': { suffix: ['.tmp', '.bak'] } }] } })
        queueHandler({ body: { case: ['beside'] }, $or: [{ body: { k: ['a'] } }, { messageAttributes: { m: { stringValue: ['b'] } } }] })
        // @ts-expect-error
        queueHandler({ $or: [{ body: { k: ['a'] } }] })
        // @ts-expect-error
        queueHandler({ messageAttributes: { kind: ['urgent'] } })
        // @ts-expect-error
        queueHandler({ attributes: { kind: ['urgent'] } })
        // @ts-expect-error
        queueHandler({})
        // @ts-expect-error
        queueHandler({ body: [1] })
    }
    expect(typeOnly).toBeFunction()
})
