import { expect, test } from 'bun:test'
import * as path from 'path'
import ts from 'typescript'
import filterVerdicts from './filters/awsVerdicts.json'
import documented from './filters/documentedPolicies.json'
import scheduleVerdicts from './schedules/eventBridgeVerdicts.json'
import { filterArgs } from './messaging/createSubscription'
import { eventSourceMappingArgs } from './queue/createQueueHandler'
import { scheduleExpression } from './schedules'

type State = { name: string, type: string, value: unknown, legal: boolean, refusal?: string }

const refusal = (write: () => unknown) => { try { write(); return undefined } catch (e) { return (e as Error).message } }
const writes = (write: () => unknown) => refusal(write) === undefined
const queueHandler = (filter: unknown) => ({ name: 's', queue: 'q', callback: { functionFolder: '.', handler: 'i.m' }, resources: {}, filter }) as never

const targets: Record<string, { type: string, write: (policy: unknown) => unknown }> = {
    'sns:attributes': { type: 'AttributePolicy', write: p => filterArgs('s', { attributes: p } as never) },
    'sns:body': { type: 'BodyPolicy', write: p => filterArgs('s', { body: p } as never) },
    'sqs:body': { type: 'BodyPolicy', write: p => eventSourceMappingArgs(queueHandler({ body: p })) },
    'sqs:attributes': { type: 'StringAttributePolicy', write: p => eventSourceMappingArgs(queueHandler({ messageAttributes: Object.fromEntries(Object.entries(p as object).map(([k, v]) => [k, Array.isArray(v) ? { stringValue: v } : v])) })) },
}

/** A state is legal when AWS took it, or documents it, and lambada writes it; every other is one lambada must not let a type build. */
const states: State[] = [
    ...documented.map(({ name, target, policy }) => {
        const { type, write } = targets[target]
        return { name: `${target} documented ${name}`, type, value: policy, legal: writes(() => write(policy)), refusal: refusal(() => write(policy)) }
    }),
    ...filterVerdicts.flatMap(v => Object.entries(targets).flatMap(([target, { type, write }]) => {
        const aws = (v as Record<string, unknown>)[target]
        return aws === undefined ? [] : [{ name: `${target} ${v.name}`, type, value: v.policy, legal: aws === 'accepts' && writes(() => write(v.policy)), refusal: refusal(() => write(v.policy)) }]
    })),
    ...scheduleVerdicts.map(v => ({
        name: v.expression, type: 'Schedule', value: v.schedule,
        legal: v.eventBridge === 'accepts' && writes(() => scheduleExpression('s', v.schedule as never)),
        refusal: refusal(() => scheduleExpression('s', v.schedule as never)),
    })),
]

/** The names of the states that do not type-check, each tried as a literal of its declared type. */
const typeErrors = (states: State[]): Set<string> => {
    const file = path.join(__dirname, '__states__.ts')
    const lines = states.map(s => `    (${JSON.stringify(s.value)}) satisfies ${s.type};`)
    const source = [
        "import type { AttributePolicy, BodyPolicy, StringAttributePolicy } from './filters'",
        "import type { Schedule } from './schedules'",
        'export const states = () => {',
        ...lines,
        '}',
    ].join('\n')
    const config = ts.getParsedCommandLineOfConfigFile(path.join(__dirname, '../tsconfig.test.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!
    const host = ts.createCompilerHost(config.options)
    const getSourceFile = host.getSourceFile
    host.getSourceFile = (name, version) => name === file ? ts.createSourceFile(name, source, version) : getSourceFile(name, version)
    host.fileExists = (name => name === file || ts.sys.fileExists(name))
    const program = ts.createProgram([file], { ...config.options, noEmit: true }, host)
    const sourceFile = program.getSourceFile(file)!
    const firstLine = 3
    return new Set(ts.getPreEmitDiagnostics(program, sourceFile)
        .map(d => sourceFile.getLineAndCharacterOfPosition(d.start!).line - firstLine)
        .filter(i => i >= 0 && i < states.length)
        .map(i => states[i].name))
}

/** SNS counts keys, combinations and wildcards, and Lambda a pattern's length, across a whole policy, which no type of one value can. */
const counted = /past the \d+ (SNS|Lambda) takes/

/** Illegal, yet a type cannot refuse them, each for its reason; each is refused when written. */
const CONSTRUCTABLE = {
    'two values the user writes, which a type cannot order': [
        'sns:attributes numEmptyRange',
        'sns:body numEmptyRange',
        'sqs:body numEmptyRange',
        'sns:attributes s2:numericEqualInclusive',
        'sns:body s2:numericEqualInclusive',
        'sqs:body s2:numericEqualInclusive',
        'sns:attributes s2:numericEqualHalfOpen',
        'sns:body s2:numericEqualHalfOpen',
        'sqs:body s2:numericEqualHalfOpen',
        'cron(* * * * ? 2030-2026)',
    ],
    'a key an index signature can neither require nor single out': [
        'sns:attributes emptyPolicy',
        'sns:body emptyPolicy',
        'sqs:body emptyPolicy',
        'sqs:attributes emptyPolicy',
        'sns:attributes s2:orOneCondition',
        'sns:body s2:orOneCondition',
        'sqs:body s2:orOneCondition',
    ],
    'a refinement of a string or number literal, which a field of plain data cannot hold': [
        'sns:attributes wildcardDouble',
        'sns:body wildcardDouble',
        'sqs:body wildcardDouble',
        'sqs:attributes wildcardDouble',
        'sns:attributes s2:cidrOctets',
        'sns:body s2:cidrOctets',
        'sqs:body s2:cidrOctets',
        'sns:attributes s2:cidrPrefix33',
        'sns:body s2:cidrPrefix33',
        'sqs:body s2:cidrPrefix33',
        'sns:attributes s2:cidrOctet256',
        'sns:body s2:cidrOctet256',
        'sqs:body s2:cidrOctet256',
        'sns:attributes s2:cidrV6Prefix129',
        'sns:body s2:cidrV6Prefix129',
        'sqs:body s2:cidrV6Prefix129',
        'sns:attributes s2:cidrColon999',
        'sns:body s2:cidrColon999',
        'sqs:body s2:cidrColon999',
        'sns:body cidr:10.0.0.0/32',
        'sns:body cidr:2001:db8::/128',
        'rate(0 minutes)',
        'rate(1.5 minutes)',
        'rate(-1 minutes)',
        'rate(2147483648 minutes)',
        'cron(* * * * ? */2147483648)',
    ],
}

test('every legal state type-checks, and every illegal one is a type error but those a type cannot hold', () => {
    const errors = typeErrors(states)
    expect(states.filter(s => s.legal && errors.has(s.name)).map(s => s.name)).toEqual([])
    const constructable = states.filter(s => !s.legal && !errors.has(s.name))
    expect(constructable.filter(s => s.refusal === undefined).map(s => s.name)).toEqual([])
    expect(constructable.filter(s => !counted.test(s.refusal ?? '')).map(s => s.name).sort()).toEqual(Object.values(CONSTRUCTABLE).flat().sort())
}, 60000)
