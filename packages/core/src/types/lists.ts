/** One or more. */
export type NonEmpty<T> = readonly [T, ...T[]]
/** Two or more: what a choice among them needs. */
export type Several<T> = readonly [T, T, ...T[]]

export const isOne = <T>(xs: readonly T[]): xs is readonly [T] => xs.length === 1
