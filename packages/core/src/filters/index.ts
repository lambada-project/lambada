import { isIPv4, isIPv6 } from 'net'
import { isOneOf, isRecord, OneOf } from '../types/forms'
import { NonEmpty, Several } from '../types/lists'

export type Scalar = string | number | boolean | null

const LOWER = ['>', '>='] as const
const UPPER = ['<', '<='] as const
type Lower = typeof LOWER[number]
type Upper = typeof UPPER[number]
type Numeric = readonly ['=', number] | readonly [Lower | Upper, number] | readonly [Lower, number, Upper, number]
type Cidr = `${number}.${number}.${number}.${number}/${number}` | `${string}:${string}/${number}`

/**
 * SQS attributes are compared as strings, so a condition there can only match a string.
 * SNS bounds a policy's keys, combinations and wildcards; Lambda takes past each bound.
 */
type Grammar = { nested: boolean, or: boolean, values: 'scalars' | 'strings', bounded: boolean }
const grammars = {
    snsAttributes: { nested: false, or: true, values: 'scalars', bounded: true },
    snsBody: { nested: true, or: true, values: 'scalars', bounded: true },
    sqsBody: { nested: true, or: true, values: 'scalars', bounded: false },
    sqsStrings: { nested: false, or: false, values: 'strings', bounded: false },
} as const satisfies Record<string, Grammar>
type Grammars = typeof grammars

type Value<G extends Grammar> = G['values'] extends 'strings' ? string : Scalar

type IgnoringCase = { 'equals-ignore-case': string }
type Matches = { prefix: string | IgnoringCase, suffix: string | IgnoringCase, wildcard: string }
type Exclusions = Record<'prefix' | 'suffix' | 'wildcard' | 'equals-ignore-case', string | NonEmpty<string>>
type Operators<V extends Scalar> = Matches & IgnoringCase & {
    exists: boolean
    cidr: Cidr
    'anything-but': string | NonEmpty<string> | (number extends V ? number | NonEmpty<number> : never) | OneOf<Exclusions>
} & (number extends V ? { numeric: Numeric } : {})

export type Condition<V extends Scalar = Scalar> = V | OneOf<Operators<V>>
export type Conditions<V extends Scalar = Scalar> = NonEmpty<Condition<V>>

/** An index signature cannot single out `$or`: the types take branches under any key, the check only under `$or`. */
type Policy<Nested extends boolean, Or extends boolean, V extends Scalar> = {
    [key: string]:
        | Conditions<V>
        | (Nested extends true ? Policy<Nested, Or, V> : never)
        | (Or extends true ? Several<Policy<Nested, Or, V>> : never)
}
type PolicyOf<G extends Grammar> = Policy<G['nested'], G['or'], Value<G>>
/**
 * SNS matches a published attribute holding `"` or `\` only when the publisher escapes it as JSON
 * would; the policy names the plain value.
 */
export type AttributePolicy = PolicyOf<Grammars['snsAttributes']>
export type BodyPolicy = PolicyOf<Grammars['snsBody']>
export type StringAttributePolicy = PolicyOf<Grammars['sqsStrings']>
type AnyPolicy = AttributePolicy | BodyPolicy | StringAttributePolicy
type Entry = AnyPolicy[string]

const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** JSON writes a number that is not finite as null, which would match null instead. */
const isScalar = (v: unknown): v is Scalar => v === null || isString(v) || isNumber(v) || typeof v === 'boolean'
const among = <T>(values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)

const values: { [V in Grammar['values']]: (v: unknown) => boolean } = { scalars: isScalar, strings: isString }

const isLower = among(LOWER)
const isUpper = among(UPPER)
/** An IPv4 or IPv6 address and a prefix below its width, as SNS takes. Lambda fails on any other rather than rejecting it. */
const isCidr = (v: unknown) => {
    const [address, prefix, ...rest] = isString(v) ? v.split('/') : []
    const width = isIPv4(address ?? '') ? 32 : isIPv6(address ?? '') ? 128 : 0
    return rest.length === 0 && width > 0 && /^\d{1,3}$/.test(prefix ?? '') && Number(prefix) < width
}
/** SNS and Lambda take a range only when its bottom is below its top, even both inclusive; two values the user writes, which a type cannot order. */
const numeric = (v: Numeric) => {
    if (!isArray(v)) return false
    if (v.length === 2) return (v[0] === '=' || isLower(v[0]) || isUpper(v[0])) && isNumber(v[1])
    return v.length === 4 && isLower(v[0]) && isNumber(v[1]) && isUpper(v[2]) && isNumber(v[3])
        && v[1] < v[3]
}

type Checks<T> = { [K in keyof T]-?: (arg: T[K]) => boolean }
const check = <T, K extends keyof T>(checks: Checks<T>, op: K, condition: { [P in K]?: T[P] }) => checks[op](condition[op]!)
/** An object holding exactly one of the operators checks knows, which holds its argument. */
const oneOf = <T extends object>(checks: Checks<T>, condition: { [K in keyof T]?: T[K] }) =>
    isOneOf<T>(condition, checks) && check(checks, Object.keys(condition)[0] as keyof T, condition)

/** `\\*` and `\\\\` are a literal star and backslash; both services reject two wildcards that meet. */
const isPattern = (v: unknown): v is string => isString(v) && !v.replace(/\\[\\*]/g, '_').includes('**')
const oneOrMany = (is: (v: unknown) => boolean) => (v: unknown) => is(v) || nonEmpty(v, (x): x is unknown => is(x))
const ignoringCase: Checks<IgnoringCase> = { 'equals-ignore-case': isString }
const caseless = (v: string | IgnoringCase) => isString(v) || oneOf(ignoringCase, v)
const matches: Checks<Matches> = { prefix: caseless, suffix: caseless, wildcard: isPattern }
const exclusions: Checks<Exclusions> = {
    prefix: oneOrMany(isString),
    suffix: oneOrMany(isString),
    wildcard: oneOrMany(isPattern),
    'equals-ignore-case': oneOrMany(isString),
}
const anythingBut = (numbers: boolean) => (v: Ops['anything-but']) => {
    if (isString(v)) return true
    if (isNumber(v)) return numbers
    if (nonEmpty(v, isString)) return true
    if (nonEmpty(v, isNumber)) return numbers
    return oneOf(exclusions, v)
}

type Ops = Operators<Scalar>
/** Every operator a condition may hold, and every form anything-but may exclude by. */
export const operatorNames = () => [...Object.keys(operators(true)), ...Object.keys(exclusions).map(k => `anything-but.${k}`)]

const operators = (numbers: boolean): Checks<Ops> => ({
    ...matches,
    ...ignoringCase,
    exists: v => typeof v === 'boolean',
    cidr: isCidr,
    'anything-but': anythingBut(numbers),
    numeric: v => numbers && numeric(v),
})

/** An index signature cannot require a key, so an empty policy is refused here. */
const isPolicy = (v: unknown): v is AnyPolicy => isRecord(v) && Object.keys(v).length > 0
const isBranches = (v: Entry): v is Extract<Entry, Several<AnyPolicy>> => isArray(v) && v.length >= 2
const isConditions = (v: Entry): v is Conditions => isArray(v) && v.length > 0

/** A condition's wildcard patterns. */
const wildcards = (c: Condition): string[] => {
    const p = typeof c !== 'object' || c === null ? undefined
        : 'wildcard' in c ? c.wildcard
        : 'anything-but' in c && isRecord(c['anything-but']) ? c['anything-but'].wildcard
        : undefined
    return isString(p) ? [p] : nonEmpty(p, isString) ? [...p] : []
}
/** SNS's three-per-pattern bound counts an escaped `\\*` too. */
const stars = (pattern: string) => pattern.split('*').length - 1
const points = (stars: number) => stars > 1 ? 3 * stars : stars

type Bounds = { pairs: Set<string>, combinations: number, complexity: number, stars: number }
/** Each bound SNS sets on a policy: the most it takes, what it measures, and what to call it. */
const LIMITS: { most: number, of: (b: Bounds) => number, called: string }[] = [
    { most: 5, of: b => b.pairs.size, called: 'keys' },
    { most: 150, of: b => b.combinations, called: 'combinations' },
    { most: 100, of: b => b.complexity, called: 'wildcard complexity' },
    { most: 3, of: b => b.stars, called: 'wildcards in a pattern' },
]

/**
 * Refuses what SNS and Lambda reject, and what they take but never match. Where SNS bounds a
 * policy, it counts as its verdicts show: a key per distinct path and value list, `$or` included;
 * combinations multiplying across keys, times each key's depth, and adding across branches; per
 * field, its patterns' wildcard points times its pattern count, a condition without a wildcard
 * being a pattern of none, added across fields.
 */
const filterCheck = (grammar: Grammar) => (name: string, policy: AnyPolicy): void => {
    const refuse = (at: string, value: unknown): never => {
        throw new Error(`${name} filters ${at || 'by'} ${JSON.stringify(value)}, which a filter policy does not take there`)
    }
    const isValue = values[grammar.values]
    const known = operators(isValue(0))
    const condition = (at: string, c: Condition) =>
        (typeof c === 'object' && c !== null ? oneOf(known, c) : isValue(c)) || refuse(at, c)
    /** `at` names a place for the user; `keys` is the path SNS counts by, which `$or` does not extend. */
    const walk = (at: string, keys: string, p: AnyPolicy, depth: number): Bounds => {
        if (!isPolicy(p)) return refuse(at, p)
        const b: Bounds = { pairs: new Set(), combinations: 1, complexity: 0, stars: 0 }
        const take = (m: Bounds) => {
            m.pairs.forEach(pair => b.pairs.add(pair))
            b.complexity += m.complexity
            b.stars = Math.max(b.stars, m.stars)
        }
        for (const [key, v] of Object.entries(p)) {
            const here = at ? `${at}.${key}` : key
            if (key === '$or') {
                if (!(grammar.or && isBranches(v))) return refuse(here, v)
                const branches = v.map((branch, i) => walk(`${here}[${i}]`, keys, branch, depth))
                branches.forEach(take)
                b.combinations *= branches.reduce((sum, m) => sum + m.combinations, 0)
            }
            else if (isConditions(v)) {
                v.forEach(c => condition(here, c))
                const counts = v.flatMap(c => wildcards(c).length ? wildcards(c).map(stars) : [0])
                b.pairs.add(`${keys}${key}=${JSON.stringify(v)}`)
                b.combinations *= v.length * depth
                b.complexity += counts.reduce((sum, n) => sum + points(n), 0) * counts.length
                b.stars = Math.max(b.stars, ...counts)
            }
            else if (grammar.nested && isPolicy(v)) {
                const m = walk(here, `${keys}${key}.`, v, depth + 1)
                take(m)
                b.combinations *= m.combinations
            }
            else return refuse(here, v)
        }
        return b
    }
    const b = walk('', '', policy, 1)
    if (!grammar.bounded) return
    for (const { most, of, called } of LIMITS)
        if (of(b) > most) throw new Error(`${name} filters with ${of(b)} ${called}, past the ${most} SNS takes`)
}

export const requireFilter = Object.fromEntries(Object.entries(grammars).map(([key, grammar]) => [key, filterCheck(grammar)])) as
    { [G in keyof Grammars]: (name: string, policy: PolicyOf<Grammars[G]>) => void }
