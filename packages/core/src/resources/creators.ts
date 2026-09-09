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

/**
 * The other shape a definition comes in: a creator that builds the thing itself, or the arguments to
 * build it from. Two helpers rather than one because the two legacy creator contracts differ — a
 * queue creator returns arguments, so `asCreator` normalises it, while a subscription creator
 * subscribes as it goes and hands back the result.
 */
export const asBuilder = <TArgs extends object, TBuilt>(
    definition: TArgs | LambadaCreatorOf<TBuilt>,
    build: (context: LambadaResources, args: TArgs) => TBuilt
): LambadaCreatorOf<TBuilt> =>
    typeof definition === 'function'
        ? definition as LambadaCreatorOf<TBuilt>
        : (context) => build(context, definition)
