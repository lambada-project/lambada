/** One or more. */
export type NonEmpty<T> = readonly [T, ...T[]]
/** Two or more: what a choice among them needs. */
export type Several<T> = readonly [T, T, ...T[]]
/** One, or a list of one or more. */
export type OneOrMany<T> = T | NonEmpty<T>

export const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v)
export const isOne = <T>(xs: readonly T[]): xs is readonly [T] => xs.length === 1
export const nonEmpty = <T>(v: unknown, is: (x: unknown) => x is T): v is NonEmpty<T> => isArray(v) && v.length > 0 && v.every(is)
export const oneOrMany = <T>(is: (x: unknown) => x is T) => (v: unknown): v is OneOrMany<T> => is(v) || nonEmpty(v, is)
/** v is one of values. */
export const among = <T>(values: readonly T[]) => (v: unknown): v is T => (values as readonly unknown[]).includes(v)
