/** One key of T, the others absent: an object holding two operators is refused. */
type OneOf<T> = { [K in keyof T]: { [P in K]: T[P] } & { [P in Exclude<keyof T, K>]?: never } }[keyof T]
type NonEmpty<T> = readonly [T, ...T[]]

export type Scalar = string | number | boolean | null

type Lower = '>' | '>='
type Upper = '<' | '<='
type Numeric = readonly ['=', number] | readonly [Lower | Upper, number] | readonly [Lower, number, Upper, number]
type Cidr = `${number}.${number}.${number}.${number}/${number}` | `${string}:${string}/${number}`

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
        | OneOf<{ prefix: string, suffix: string, 'equals-ignore-case': string | NonEmpty<string>, wildcard: string }>
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const listOf = (is: (v: unknown) => boolean) => (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(is)
const single = (v: unknown): [string, unknown] | undefined => {
    const entries = isRecord(v) ? Object.entries(v) : []
    return entries.length === 1 ? entries[0] : undefined
}

const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]*:[0-9a-f:]*\/\d{1,3}$/i
const numeric = (v: unknown) => {
    if (!Array.isArray(v)) return false
    const [op, a, upper, b] = v
    if (v.length === 2) return ['=', '>', '>=', '<', '<='].includes(op) && isNumber(a)
    return v.length === 4 && ['>', '>='].includes(op) && ['<', '<='].includes(upper) && isNumber(a) && isNumber(b) && a < b
}
const anythingBut = (numbers: boolean) => (v: unknown) => {
    const [op, arg] = single(v) ?? []
    return isString(v) || listOf(isString)(v)
        || (numbers && (isNumber(v) || listOf(isNumber)(v)))
        || (op === 'equals-ignore-case' && (isString(arg) || listOf(isString)(arg)))
        || (['prefix', 'suffix', 'wildcard'].includes(op!) && isString(arg))
}

const operators = (numbers: boolean): Record<string, (arg: unknown) => boolean> => ({
    prefix: isString,
    suffix: isString,
    'equals-ignore-case': isString,
    wildcard: isString,
    exists: v => typeof v === 'boolean',
    cidr: v => isString(v) && cidr.test(v),
    'anything-but': anythingBut(numbers),
    ...(numbers && { numeric }),
})

/** Refuses what SNS and Lambda reject, and what they take but never match. */
export const requireFilter = (name: string, policy: unknown, grammar: Grammar): void => {
    const refuse = (path: string, value: unknown): never => {
        throw new Error(`${name} filters ${path || 'by'} ${JSON.stringify(value)}, which a filter policy does not take there`)
    }
    const known = operators(grammar.numbers)
    const scalar = (v: unknown) => grammar.numbers ? v === null || ['string', 'number', 'boolean'].includes(typeof v) : isString(v)
    const condition = (path: string, c: unknown) => {
        if (!isRecord(c)) return scalar(c) || refuse(path, c)
        const [op, arg] = single(c) ?? []
        return (op !== undefined && known[op]?.(arg)) || refuse(path, c)
    }
    const policyAt = (path: string, p: unknown): void => {
        if (!isRecord(p) || Object.keys(p).length === 0) return void refuse(path, p)
        for (const [key, v] of Object.entries(p)) {
            const at = path ? `${path}.${key}` : key
            if (key === '$or' && grammar.or) {
                if (!Array.isArray(v) || v.length < 2) refuse(at, v)
                ;(v as unknown[]).forEach((branch, i) => policyAt(`${at}[${i}]`, branch))
            }
            else if (Array.isArray(v)) {
                if (v.length === 0) refuse(at, v)
                v.forEach(c => condition(at, c))
            }
            else if (grammar.nested && isRecord(v)) policyAt(at, v)
            else refuse(at, v)
        }
    }
    policyAt('', policy)
}
