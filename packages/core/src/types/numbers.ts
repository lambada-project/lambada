export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type Positive = Exclude<Digit, 0>
/** The numbers a union of digit strings spells, so a range can be written as its digits. */
export type Numbers<S> = S extends `${infer N extends number}` ? N : never
/** A list's positions counted from 1, as a named field ranks its values. */
export type Positions<T extends readonly unknown[]> = keyof [...T, unknown] extends infer K ? K extends `${infer I extends number}` ? Exclude<I, 0> : never : never
