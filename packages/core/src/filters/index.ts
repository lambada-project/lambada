/** One key of T, the others absent: an object holding two operators is refused. */
type OneOf<T> = { [K in keyof T]: { [P in K]: T[P] } & { [P in Exclude<keyof T, K>]?: never } }[keyof T]
type NonEmpty<T> = readonly [T, ...T[]]

export type Scalar = string | number | boolean | null

type Lower = '>' | '>='
type Upper = '<' | '<='
type Numeric = readonly ['=', number] | readonly [Lower | Upper, number] | readonly [Lower, number, Upper, number]
type Cidr = `${number}.${number}.${number}.${number}/${number}` | `${string}:${string}/${number}`

type Exclusions = { prefix: string, suffix: string, 'equals-ignore-case': string | NonEmpty<string>, wildcard: string }

type Operators<V extends Scalar> = {
    prefix: string
    suffix: string
    'equals-ignore-case': string
    wildcard: string
    exists: boolean
    cidr: Cidr
    'anything-but':
        | string
        | NonEmpty<string>
        | (number extends V ? number | NonEmpty<number> : never)
        | OneOf<Exclusions>
} & (number extends V ? { numeric: Numeric } : {})

export type Condition<V extends Scalar = Scalar> = V | OneOf<Operators<V>>
export type Conditions<V extends Scalar = Scalar> = NonEmpty<Condition<V>>

type Branches<P> = readonly [P, P, ...P[]]

/** Flat: a key per attribute. `$or` takes two policies or more. */
export type AttributePolicy = { [name: string]: Conditions | Branches<AttributePolicy> }
/** Nested as the body is. `$or` takes two policies or more. */
export type BodyPolicy = { [key: string]: Conditions | BodyPolicy | Branches<BodyPolicy> }
/** Matched as strings, so only string conditions can match; no `$or`. */
export type StringAttributePolicy = { [name: string]: Conditions<string> }

type Grammar = { nested: boolean, or: boolean, numbers: boolean }
export const grammars = {
    attributes: { nested: false, or: true, numbers: true },
    body: { nested: true, or: true, numbers: true },
    stringAttributes: { nested: false, or: false, numbers: false },
} satisfies Record<string, Grammar>

type Ops = Operators<Scalar>
type Policy = AttributePolicy | BodyPolicy | StringAttributePolicy
type Entry = Policy[string]

const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)
const onlyKey = <T extends object>(o: T) => {
    const keys = Object.keys(o) as (keyof T)[]
    return keys.length === 1 ? keys[0] : undefined
}

const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]*:[0-9a-f:]*\/\d{1,3}$/i
const numeric = (v: Numeric) => {
    if (!isArray(v)) return false
    if (v.length === 2) return ['=', '>', '>=', '<', '<='].includes(v[0]) && isNumber(v[1])
    return v.length === 4 && ['>', '>='].includes(v[0]) && ['<', '<='].includes(v[2]) && isNumber(v[1]) && isNumber(v[3]) && v[1] < v[3]
}
type Checks<T> = { [K in keyof T]: (arg: T[K]) => boolean }
const check = <T, K extends keyof T>(checks: Checks<T>, op: K, condition: { [P in K]?: T[P] }) => checks[op](condition[op]!)
/** An object holding exactly one of the operators checks knows, which holds its argument. */
const oneOf = <T extends object>(checks: Checks<T>, condition: { [K in keyof T]?: T[K] }) => {
    if (typeof condition !== 'object' || condition === null || isArray(condition)) return false
    const op = onlyKey(condition)
    return op !== undefined && op in checks && check(checks, op, condition)
}

const exclusions: Checks<Exclusions> = {
    prefix: isString,
    suffix: isString,
    'equals-ignore-case': v => isString(v) || nonEmpty(v, isString),
    wildcard: isString,
}
const anythingBut = (numbers: boolean) => (v: Ops['anything-but']) => {
    if (isString(v)) return true
    if (isNumber(v)) return numbers
    if (nonEmpty(v, isString)) return true
    if (nonEmpty(v, isNumber)) return numbers
    return oneOf(exclusions, v)
}

const operators = (numbers: boolean): Checks<Ops> => ({
    prefix: isString,
    suffix: isString,
    'equals-ignore-case': isString,
    wildcard: isString,
    exists: v => typeof v === 'boolean',
    cidr: v => isString(v) && cidr.test(v),
    'anything-but': anythingBut(numbers),
    numeric: v => numbers && numeric(v),
})

const isBranches = (key: string, v: Entry): v is Branches<Policy> => key === '$or' && isArray(v)
const isConditions = (v: Entry): v is Conditions => isArray(v)
const isNested = (v: Entry): v is BodyPolicy => typeof v === 'object' && v !== null && !isArray(v)

/** Refuses what SNS and Lambda reject, and what they take but never match. */
export const requireFilter = (name: string, policy: Policy, grammar: Grammar): void => {
    const refuse = (path: string, value: unknown): never => {
        throw new Error(`${name} filters ${path || 'by'} ${JSON.stringify(value)}, which a filter policy does not take there`)
    }
    const known = operators(grammar.numbers)
    const scalar = (v: Scalar) => grammar.numbers ? v === null || ['string', 'number', 'boolean'].includes(typeof v) : isString(v)
    const condition = (path: string, c: Condition) => {
        if (c === null || typeof c !== 'object') return scalar(c) || refuse(path, c)
        return oneOf(known, c) || refuse(path, c)
    }
    const policyAt = (path: string, p: Policy): void => {
        if (p === null || typeof p !== 'object' || isArray(p) || Object.keys(p).length === 0) return void refuse(path, p)
        for (const [key, v] of Object.entries(p)) {
            const at = path ? `${path}.${key}` : key
            if (grammar.or && isBranches(key, v)) {
                if (v.length < 2) refuse(at, v)
                v.forEach((branch, i) => policyAt(`${at}[${i}]`, branch))
            }
            else if (isConditions(v)) {
                if (v.length === 0) refuse(at, v)
                v.forEach(c => condition(at, c))
            }
            else if (grammar.nested && isNested(v)) policyAt(at, v)
            else refuse(at, v)
        }
    }
    policyAt('', policy)
}
