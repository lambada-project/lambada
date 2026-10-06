type Keys<U> = U extends unknown ? keyof U : never

/** Each member of U holds its own keys and none of another member's, which a union alone would let it mix. */
export type Exclusive<U, All = U> = U extends unknown ? U & { [K in Exclude<Keys<All>, keyof U>]?: never } : never
