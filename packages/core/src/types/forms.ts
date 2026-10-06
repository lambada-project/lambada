type Keys<U> = U extends unknown ? keyof U : never

/** Each member of U holds its own keys and none of another member's, which a union alone would let it mix. */
export type Exclusive<U, All = U> = U extends unknown ? U & { [K in Exclude<Keys<All>, keyof U>]?: never } : never
/** Exactly one of T's keys. */
export type OneOf<T> = Exclusive<{ [K in keyof T]: Pick<T, K> }[keyof T]>
/** One or more of T's keys. */
export type Some<T> = { [K in keyof T]: Pick<T, K> & Partial<T> }[keyof T]

/** A table with an entry for each of T's keys, which is how the runtime knows them. */
type Known<T> = { [K in keyof T]-?: unknown }
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const holds = (v: unknown, known: object, count: (n: number) => boolean) =>
    isRecord(v) && count(Object.keys(v).length) && Object.keys(v).every(key => Object.keys(known).includes(key))
/** v holds exactly one key, and known has it. */
export const isOneOf = <T>(v: unknown, known: Known<T>): v is OneOf<T> => holds(v, known, n => n === 1)
/** v holds one key or more, and known has each. */
export const isSome = <T>(v: unknown, known: Known<T>): v is Some<T> => holds(v, known, n => n > 0)

/** Each key of form F, and whether F requires it, read from F's own type: a shape that misses a key, adds one or misreads one is a type error. */
export type Shape<F> = { [K in keyof F]-?: {} extends Pick<F, K> ? 'optional' : 'required' }
/** v is form F: it holds every key F requires, and no key F lacks. */
export const isForm = <F extends object>(v: unknown, shape: Shape<F>): v is F =>
    holds(v, shape, () => true) && Object.entries(shape).every(([key, need]) => need === 'optional' || (v as Record<string, unknown>)[key] !== undefined)
