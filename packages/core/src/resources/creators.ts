import { LambadaResources } from "../context";

/** Anything `run()` accepts by definition: the value itself, or a creator that builds it. */
export type LambadaDefinition<T> = T | LambadaCreatorOf<T>

export type LambadaCreatorOf<T> = (context: LambadaResources) => T

/**
 * A definition as a creator, whichever of the two shapes it arrived in: a creator that builds the
 * result itself, or the arguments to build it from.
 *
 * Both shapes exist because the older creator contracts differ — a queue creator returns arguments,
 * a subscription creator subscribes as it goes and hands back the result — and this is the one
 * place that tells a creator from a value, so no caller repeats the test.
 *
 * The one thing it cannot do is carry a `TArgs` that is itself a function: nothing distinguishes
 * that from a creator. Every definition lambada accepts is an object, so the question does not
 * arise, but a caller passing a callable as arguments would find it invoked as a creator.
 */
export const asBuilder = <TArgs, TBuilt>(
    definition: TArgs | LambadaCreatorOf<TBuilt>,
    build: (context: LambadaResources, args: TArgs) => TBuilt
): LambadaCreatorOf<TBuilt> =>
    typeof definition === 'function'
        ? definition as LambadaCreatorOf<TBuilt>
        : (context) => build(context, definition)

/**
 * A definition whose creator already yields the finished value, so there is nothing left to build.
 * The common case, and `asBuilder` with the build step that returns what it was given.
 */
export const asCreator = <T>(definition: LambadaDefinition<T>): LambadaCreatorOf<T> =>
    asBuilder<T, T>(definition, (_context, value) => value)
