/** One key of T, the others absent: an object holding two operators is refused. */
type OneOf<T> = { [K in keyof T]: { [P in K]: T[P] } & { [P in Exclude<keyof T, K>]?: never } }[keyof T]
type NonEmpty<T> = readonly [T, ...T[]]
type Branches<P> = readonly [P, P, ...P[]]

export type Scalar = string | number | boolean | null

const LOWER = ['>', '>='] as const
const UPPER = ['<', '<='] as const
type Lower = typeof LOWER[number]
type Upper = typeof UPPER[number]
type Numeric = readonly ['=', number] | readonly [Lower | Upper, number] | readonly [Lower, number, Upper, number]
type Cidr = `${number}.${number}.${number}.${number}/${number}` | `${string}:${string}/${number}`

/** SQS attributes are compared as strings, so a condition there can only match a string. */
type Grammar = { nested: boolean, or: boolean, values: 'scalars' | 'strings' }
const grammars = {
    attributes: { nested: false, or: true, values: 'scalars' },
    body: { nested: true, or: true, values: 'scalars' },
    stringAttributes: { nested: false, or: false, values: 'strings' },
} as const satisfies Record<string, Grammar>
type Grammars = typeof grammars

type Value<G extends Grammar> = G['values'] extends 'strings' ? string : Scalar

type Matches = { prefix: string, suffix: string, wildcard: string }
type Exclusions = Matches & { 'equals-ignore-case': string | NonEmpty<string> }
type Operators<V extends Scalar> = Matches & {
    'equals-ignore-case': string
    exists: boolean
    cidr: Cidr
    'anything-but': string | NonEmpty<string> | (number extends V ? number | NonEmpty<number> : never) | OneOf<Exclusions>
} & (number extends V ? { numeric: Numeric } : {})

export type Condition<V extends Scalar = Scalar> = V | OneOf<Operators<V>>
export type Conditions<V extends Scalar = Scalar> = NonEmpty<Condition<V>>

/** An index signature cannot single out `$or`: the types take branches under any key, the check only under `$or`. */
type Policy<G extends Grammar> = {
    [key: string]:
        | Conditions<Value<G>>
        | (G['nested'] extends true ? Policy<G> : never)
        | (G['or'] extends true ? Branches<Policy<G>> : never)
}
export type AttributePolicy = Policy<Grammars['attributes']>
export type BodyPolicy = Policy<Grammars['body']>
export type StringAttributePolicy = Policy<Grammars['stringAttributes']>
type AnyPolicy = AttributePolicy | BodyPolicy | StringAttributePolicy
type Entry = AnyPolicy[string]

const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isScalar = (v: unknown): v is Scalar => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const among = <T>(values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)

const values: { [V in Grammar['values']]: (v: unknown) => boolean } = { scalars: isScalar, strings: isString }

const isLower = among(LOWER)
const isUpper = among(UPPER)
const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]*:[0-9a-f:]*\/\d{1,3}$/i
const numeric = (v: Numeric) => {
    if (!isArray(v)) return false
    if (v.length === 2) return (v[0] === '=' || isLower(v[0]) || isUpper(v[0])) && isNumber(v[1])
    return v.length === 4 && isLower(v[0]) && isNumber(v[1]) && isUpper(v[2]) && isNumber(v[3]) && v[1] < v[3]
}

type Checks<T> = { [K in keyof T]: (arg: T[K]) => boolean }
const check = <T, K extends keyof T>(checks: Checks<T>, op: K, condition: { [P in K]?: T[P] }) => checks[op](condition[op]!)
/** An object holding exactly one of the operators checks knows, which holds its argument. */
const oneOf = <T extends object>(checks: Checks<T>, condition: { [K in keyof T]?: T[K] }) => {
    const keys = isRecord(condition) ? Object.keys(condition) as (keyof T)[] : []
    return keys.length === 1 && keys[0] in checks && check(checks, keys[0], condition)
}

const matches: Checks<Matches> = { prefix: isString, suffix: isString, wildcard: isString }
const exclusions: Checks<Exclusions> = { ...matches, 'equals-ignore-case': v => isString(v) || nonEmpty(v, isString) }
const anythingBut = (numbers: boolean) => (v: Ops['anything-but']) => {
    if (isString(v)) return true
    if (isNumber(v)) return numbers
    if (nonEmpty(v, isString)) return true
    if (nonEmpty(v, isNumber)) return numbers
    return oneOf(exclusions, v)
}

type Ops = Operators<Scalar>
const operators = (numbers: boolean): Checks<Ops> => ({
    ...matches,
    'equals-ignore-case': isString,
    exists: v => typeof v === 'boolean',
    cidr: v => isString(v) && cidr.test(v),
    'anything-but': anythingBut(numbers),
    numeric: v => numbers && numeric(v),
})

const isPolicy = (v: unknown): v is AnyPolicy => isRecord(v) && Object.keys(v).length > 0
const isBranches = (key: string, v: Entry): v is Extract<Entry, Branches<AnyPolicy>> => key === '$or' && isArray(v) && v.length >= 2
const isConditions = (v: Entry): v is Conditions => isArray(v) && v.length > 0

/** Refuses what SNS and Lambda reject, and what they take but never match. */
const filterCheck = (grammar: Grammar) => (name: string, policy: AnyPolicy): void => {
    const refuse = (path: string, value: unknown): never => {
        throw new Error(`${name} filters ${path || 'by'} ${JSON.stringify(value)}, which a filter policy does not take there`)
    }
    const isValue = values[grammar.values]
    const known = operators(isValue(0))
    const condition = (path: string, c: Condition) =>
        (typeof c === 'object' && c !== null ? oneOf(known, c) : isValue(c)) || refuse(path, c)
    const policyAt = (path: string, p: AnyPolicy): void => {
        if (!isPolicy(p)) return void refuse(path, p)
        for (const [key, v] of Object.entries(p)) {
            const at = path ? `${path}.${key}` : key
            if (grammar.or && isBranches(key, v)) v.forEach((branch, i) => policyAt(`${at}[${i}]`, branch))
            else if (isConditions(v)) v.forEach(c => condition(at, c))
            else if (grammar.nested && isPolicy(v)) policyAt(at, v)
            else refuse(at, v)
        }
    }
    policyAt('', policy)
}

export const requireFilter: { [G in keyof Grammars]: (name: string, policy: Policy<Grammars[G]>) => void } = {
    attributes: filterCheck(grammars.attributes),
    body: filterCheck(grammars.body),
    stringAttributes: filterCheck(grammars.stringAttributes),
}
