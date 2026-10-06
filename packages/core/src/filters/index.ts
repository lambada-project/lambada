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
type Operators<V extends Scalar> = Matches & {
    'equals-ignore-case': string
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
        | (Or extends true ? Branches<Policy<Nested, Or, V>> : never)
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
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** JSON writes a number that is not finite as null, which would match null instead. */
const isScalar = (v: unknown): v is Scalar => v === null || isString(v) || isNumber(v) || typeof v === 'boolean'
const among = <T>(values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)

const values: { [V in Grammar['values']]: (v: unknown) => boolean } = { scalars: isScalar, strings: isString }

const isLower = among(LOWER)
const isUpper = among(UPPER)
const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]*:[0-9a-f:]*\/\d{1,3}$/i
/** A range holds a number: its bounds, two values the user writes, are ordered, or equal and both inclusive, which a type cannot say. */
const numeric = (v: Numeric) => {
    if (!isArray(v)) return false
    if (v.length === 2) return (v[0] === '=' || isLower(v[0]) || isUpper(v[0])) && isNumber(v[1])
    return v.length === 4 && isLower(v[0]) && isNumber(v[1]) && isUpper(v[2]) && isNumber(v[3])
        && (v[1] < v[3] || (v[1] === v[3] && v[0] === '>=' && v[2] === '<='))
}

type Checks<T> = { [K in keyof T]: (arg: T[K]) => boolean }
const check = <T, K extends keyof T>(checks: Checks<T>, op: K, condition: { [P in K]?: T[P] }) => checks[op](condition[op]!)
/** An object holding exactly one of the operators checks knows, which holds its argument. */
const oneOf = <T extends object>(checks: Checks<T>, condition: { [K in keyof T]?: T[K] }) => {
    const keys = isRecord(condition) ? Object.keys(condition) as (keyof T)[] : []
    return keys.length === 1 && keys[0] in checks && check(checks, keys[0], condition)
}

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
    'equals-ignore-case': isString,
    exists: v => typeof v === 'boolean',
    cidr: v => isString(v) && cidr.test(v),
    'anything-but': anythingBut(numbers),
    numeric: v => numbers && numeric(v),
})

/** An index signature cannot require a key, so an empty policy is refused here. */
const isPolicy = (v: unknown): v is AnyPolicy => isRecord(v) && Object.keys(v).length > 0
const isBranches = (key: string, v: Entry): v is Extract<Entry, Branches<AnyPolicy>> => key === '$or' && isArray(v) && v.length >= 2
const isConditions = (v: Entry): v is Conditions => isArray(v) && v.length > 0

/** A condition's wildcard patterns; one without any is still a pattern of the field. */
const patterns = (c: Condition): string[] => {
    const p = typeof c !== 'object' || c === null ? undefined
        : 'wildcard' in c ? c.wildcard
        : 'anything-but' in c && isRecord(c['anything-but']) ? c['anything-but'].wildcard
        : undefined
    return isString(p) ? [p] : nonEmpty(p, isString) ? [...p] : ['']
}
/** SNS's three-per-pattern bound counts an escaped `\\*` too. */
const stars = (pattern: string) => pattern.split('*').length - 1
const points = (stars: number) => stars > 1 ? 3 * stars : stars

type Bounds = { pairs: Set<string>, combinations: number, complexity: number, stars: number }
/**
 * What SNS counts, as its verdicts show: a key per distinct path and value list, `$or` included;
 * combinations multiplying across keys, times each key's depth, and adding across branches;
 * per field, its patterns' wildcard points times its pattern count, added across fields.
 */
const bounds = (p: AnyPolicy, path = '', depth = 1): Bounds => {
    const b: Bounds = { pairs: new Set(), combinations: 1, complexity: 0, stars: 0 }
    const take = (m: Bounds) => {
        m.pairs.forEach(pair => b.pairs.add(pair))
        b.complexity += m.complexity
        b.stars = Math.max(b.stars, m.stars)
    }
    for (const [key, v] of Object.entries(p)) {
        if (isBranches(key, v)) {
            const branches = v.map(branch => bounds(branch, path, depth))
            branches.forEach(take)
            b.combinations *= branches.reduce((sum, m) => sum + m.combinations, 0)
        }
        else if (isConditions(v)) {
            const counts = v.flatMap(patterns).map(stars)
            b.pairs.add(`${path}${key}=${JSON.stringify(v)}`)
            b.combinations *= v.length * depth
            b.complexity += counts.reduce((sum, n) => sum + points(n), 0) * counts.length
            b.stars = Math.max(b.stars, ...counts)
        }
        else if (isPolicy(v)) {
            const m = bounds(v, `${path}${key}.`, depth + 1)
            take(m)
            b.combinations *= m.combinations
        }
    }
    return b
}
const LIMITS = { keys: 5, combinations: 150, complexity: 100, stars: 3 }

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
            if (key === '$or') grammar.or && isBranches(key, v) ? v.forEach((branch, i) => policyAt(`${at}[${i}]`, branch)) : refuse(at, v)
            else if (isConditions(v)) v.forEach(c => condition(at, c))
            else if (grammar.nested && isPolicy(v)) policyAt(at, v)
            else refuse(at, v)
        }
    }
    policyAt('', policy)
    if (!grammar.bounded) return
    const b = bounds(policy)
    const measured = { keys: b.pairs.size, combinations: b.combinations, complexity: b.complexity, stars: b.stars }
    for (const [what, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][])
        if (measured[what] > limit) throw new Error(`${name} filters with ${measured[what]} ${what === 'stars' ? 'wildcards in a pattern' : what === 'complexity' ? 'wildcard complexity' : what}, past the ${limit} SNS takes`)
}

export const requireFilter: { [G in keyof Grammars]: (name: string, policy: PolicyOf<Grammars[G]>) => void } = {
    snsAttributes: filterCheck(grammars.snsAttributes),
    snsBody: filterCheck(grammars.snsBody),
    sqsBody: filterCheck(grammars.sqsBody),
    sqsStrings: filterCheck(grammars.sqsStrings),
}
