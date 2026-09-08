import { LambadaResources } from "../context";

/** Anything `run()` accepts by definition: the value itself, or a creator that builds it. */
export type LambadaDefinition<T> = T | LambadaCreatorOf<T>

export type LambadaCreatorOf<T> = (context: LambadaResources) => T

/**
 * One creator, whichever form was handed over. A plain object is a creator that ignores the
 * context, so everything downstream stays on the single `definition(context)` path lambada has
 * always had, and no caller re-implements the test.
 */
export const asCreator = <T>(definition: LambadaDefinition<T>): LambadaCreatorOf<T> =>
    typeof definition === 'function' ? definition as LambadaCreatorOf<T> : () => definition
