import * as pulumi from "@pulumi/pulumi";

/**
 * An `Input` of any shape — a plain value, a promise, or an `Output` — as an `Output` of the mapped
 * value.
 *
 * Always an `Output`, never sometimes the bare value. A lift that hands back whichever shape it was
 * given reads as sound until the wrapper reaches a synchronous position — a template string, a
 * boolean test — where an object is simply truthy and the value it holds never arrives.
 *
 * `map` may return a plain value, a promise, or another `Output`, and the result is flattened
 * either way. The overloads mirror `Output.apply`, which is what makes that flattening typed
 * rather than merely true at runtime.
 */
export function lift<T, U>(
    input: pulumi.Input<T>,
    map: (value: pulumi.Unwrap<T>) => pulumi.Output<U>
): pulumi.Output<U>
export function lift<T, U>(
    input: pulumi.Input<T>,
    map: (value: pulumi.Unwrap<T>) => Promise<U>
): pulumi.Output<U>
export function lift<T, U>(
    input: pulumi.Input<T>,
    map: (value: pulumi.Unwrap<T>) => U
): pulumi.Output<U>
export function lift<T, U>(
    input: pulumi.Input<T>,
    map: (value: pulumi.Unwrap<T>) => pulumi.Input<U>
): pulumi.Output<U> {
    return pulumi.output(input).apply(map as (value: pulumi.Unwrap<T>) => U)
}

/** Two inputs resolved together, for what one `lift` cannot express. */
export function lift2<A, B, U>(
    a: pulumi.Input<A>,
    b: pulumi.Input<B>,
    map: (a: pulumi.Unwrap<A>, b: pulumi.Unwrap<B>) => pulumi.Output<U>
): pulumi.Output<U>
export function lift2<A, B, U>(
    a: pulumi.Input<A>,
    b: pulumi.Input<B>,
    map: (a: pulumi.Unwrap<A>, b: pulumi.Unwrap<B>) => Promise<U>
): pulumi.Output<U>
export function lift2<A, B, U>(
    a: pulumi.Input<A>,
    b: pulumi.Input<B>,
    map: (a: pulumi.Unwrap<A>, b: pulumi.Unwrap<B>) => U
): pulumi.Output<U>
export function lift2<A, B, U>(
    a: pulumi.Input<A>,
    b: pulumi.Input<B>,
    map: (a: pulumi.Unwrap<A>, b: pulumi.Unwrap<B>) => pulumi.Input<U>
): pulumi.Output<U> {
    return pulumi.all([a, b]).apply(([x, y]) => map(x, y) as U)
}
