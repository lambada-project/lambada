type AllKeys<U> = U extends unknown ? keyof U : never

/** Each member of U holds its own keys and none of another member's, which a union alone would let it mix. */
export type Exclusive<U, All = U> = U extends unknown ? U & { [K in Exclude<AllKeys<All>, keyof U>]?: never } : never
/** Exactly one of T's keys. */
export type OneOf<T> = Exclusive<{ [K in keyof T]: Pick<T, K> }[keyof T]>
/** One or more of T's keys. */
export type SomeOf<T> = { [K in keyof T]: Pick<T, K> & Partial<T> }[keyof T]

/** An entry for each of T's keys, which is how the runtime knows them. */
type KeyTable<T> = { [K in keyof T]-?: unknown }
/** A check for each of T's keys, of the value it holds. */
export type Checks<T> = { [K in keyof T]-?: (arg: T[K]) => boolean }
/** Each key of form F, and whether F requires it, read from F's own type: a shape that misses a key, adds one or misreads one is a type error. */
export type Shape<F> = { [K in keyof F]-?: {} extends Pick<F, K> ? 'optional' : 'required' }

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasKeys = (v: unknown, keys: object, count: (n: number) => boolean) =>
    isRecord(v) && count(Object.keys(v).length) && Object.keys(v).every(key => Object.keys(keys).includes(key))

/** v holds exactly one key, and keys has it. */
export const isOneOf = <T>(v: unknown, keys: KeyTable<T>): v is OneOf<T> => hasKeys(v, keys, n => n === 1)
/** v holds one key or more, and keys has each. */
export const isSomeOf = <T>(v: unknown, keys: KeyTable<T>): v is SomeOf<T> => hasKeys(v, keys, n => n > 0)
/** v holds exactly one of the keys checks has, and its value passes. */
export const passesOneOf = <T extends object>(v: { [K in keyof T]?: T[K] }, checks: Checks<T>): boolean => {
    if (!isOneOf<T>(v, checks)) return false
    const key = Object.keys(v)[0] as keyof T
    return checks[key](v[key]!)
}
/** v is form F: it holds every key F requires, and no key F lacks. */
export const hasShape = <F extends object>(v: unknown, shape: Shape<F>): v is F =>
    hasKeys(v, shape, () => true) && Object.entries(shape).every(([key, need]) => need === 'optional' || (v as Record<string, unknown>)[key] !== undefined)
