export type NonEmpty<T> = readonly [T, ...T[]]
export type Several<T> = readonly [T, T, ...T[]]
export type OneOrMany<T> = T | NonEmpty<T>

/** A list as JSON holds one: iteration skips a hole, which JSON writes as null, so an array with one is not a list. */
export const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v) && Array.from(v.keys()).every(i => i in v)
export const isOne = <T>(xs: readonly T[]): xs is readonly [T] => xs.length === 1
export const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)
export const oneOrMany = <T>(is: (x: unknown) => x is T) => (v: unknown): v is OneOrMany<T> => is(v) || nonEmpty(v, is)
export const among = <T>(values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
