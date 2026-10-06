export const isString = (v: unknown): v is string => typeof v === 'string'
/** A finite number: JSON writes any other as null. */
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
