import * as pulumi from "@pulumi/pulumi"

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY'

/** A route as the API declares it, by method and path template: `GET /api/users/{id}`. */
export type SignedRoute = `${RouteMethod} /${string}`

/** What a stack publishes of its API for other stacks to call: every route that requires a signature. */
export type SignedApi = {
    executionArn: string
    /** The stage's base URL, which a route's path follows. */
    url: string
    stage: string
    routes: SignedRoute[]
}

export type ApiDefinition = {
    /** What the owner published, as run() returns it under `signedApi`, usually read through a StackReference. */
    api: pulumi.Input<SignedApi>
    /** The variable a granted function reads the base URL from. */
    envKeyName: string
}

export type LambadaApisRef = { [key: string]: ApiDefinition }

export type ApisResultItem = { key: string, api: pulumi.Output<SignedApi>, envKeyName: string }

export type ApisResult = { [key: string]: ApisResultItem }

const isResultItem = (item: ApiDefinition | ApisResultItem): item is ApisResultItem => 'key' in item

/** Each API as a grant resolves it. A result of an earlier run passes through. */
export const createApis = (apisRef?: LambadaApisRef | ApisResult): ApisResult =>
    Object.fromEntries(Object.entries<ApiDefinition | ApisResultItem>(apisRef ?? {}).map(([key, item]) =>
        [key, isResultItem(item) ? item : { key, api: pulumi.output(item.api) as pulumi.Output<SignedApi>, envKeyName: item.envKeyName }]))

/** The resources IAM checks the granted routes against. Throws for a route the API does not sign, and for a grant reaching further. */
export const grantedRouteArns = (functionName: string, key: string, api: SignedApi, routes: readonly string[]): string[] => {
    const unsigned = routes.filter(route => !api.routes.includes(route as SignedRoute))
    if (unsigned.length > 0) {
        throw new Error(
            `${functionName}: grants api '${key}' ${unsigned.join(', ')}, which it does not sign. ` +
            `It signs: ${api.routes.length ? api.routes.join(', ') : 'none'}.`
        )
    }
    const granted = routes as readonly SignedRoute[]
    const reached = api.routes.filter(other => !granted.includes(other) && granted.some(route => reaches(api.routes, route, other)))
    if (reached.length > 0) {
        throw new Error(
            `${functionName}: grants api '${key}' ${granted.join(', ')}, which IAM also matches for ${reached.join(', ')}: ` +
            `a parameter becomes '*', and IAM's '*' spans '/'. Grant ${reached.length > 1 ? 'those' : 'that'} too, ` +
            `or give the routes paths that do not nest.`
        )
    }
    return granted.map(route => routeArn(api, route))
}

/** IAM matches a request's path, not the route's template, so each parameter is a wildcard. */
const routeArn = (api: SignedApi, route: SignedRoute): string => {
    const { method, segments } = parse(route)
    const path = segments.map(segment => segment.kind === 'static' ? segment.text : '*').join('/')
    return `${api.executionArn}/${api.stage}/${method === 'ANY' ? '*' : method}/${path}`
}

type Segment = { kind: 'static', text: string } | { kind: 'param' } | { kind: 'greedy' }

const parse = (route: SignedRoute): { method: RouteMethod, segments: Segment[] } => {
    const [method, path] = route.split(' ') as [RouteMethod, string]
    const segments = path.split('/').filter(Boolean).map((text): Segment =>
        /^\{.+\+\}$/.test(text) ? { kind: 'greedy' } : /^\{.+\}$/.test(text) ? { kind: 'param' } : { kind: 'static', text })
    return { method, segments }
}

const METHODS: RouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const templateMatches = (segments: Segment[], request: string[]): boolean => {
    if (segments.length === 0) return request.length === 0
    const [first, ...rest] = segments
    if (first.kind === 'greedy') return request.length > 0 && rest.length === 0
    return request.length > 0 && (first.kind === 'param' || first.text === request[0]) && templateMatches(rest, request.slice(1))
}

/** API Gateway's most specific match: a static segment over a parameter over `{proxy+}`, then a method over ANY. */
const routeFor = (routes: readonly SignedRoute[], method: RouteMethod, request: string[]): SignedRoute | undefined => {
    const rank = (segment: Segment) => segment.kind === 'static' ? 2 : segment.kind === 'param' ? 1 : 0
    const candidates = routes.map(route => ({ route, ...parse(route) }))
        .filter(c => (c.method === method || c.method === 'ANY') && templateMatches(c.segments, request))
    candidates.sort((a, b) => {
        for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
            const d = rank(b.segments[i] ?? { kind: 'greedy' }) - rank(a.segments[i] ?? { kind: 'greedy' })
            if (d !== 0) return d
        }
        return (a.method === 'ANY' ? 1 : 0) - (b.method === 'ANY' ? 1 : 0)
    })
    return candidates[0]?.route
}

/**
 * Whether the ARN granting `route` also matches a request API Gateway sends to `other`. Requests are
 * built from `other` with each parameter taking a fresh value or any static segment the API declares,
 * which are the only values that change either the match or the routing.
 */
const reaches = (routes: readonly SignedRoute[], route: SignedRoute, other: SignedRoute): boolean => {
    const granted = parse(route), target = parse(other)
    const glob = new RegExp(`^${granted.segments.map(s => s.kind === 'static' ? s.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '.*').join('/')}$`)
    const values = ['x', ...new Set(routes.flatMap(r => parse(r).segments.flatMap(s => s.kind === 'static' ? [s.text] : [])))]
    const limit = granted.segments.length + 1
    const requests = target.segments.reduce<string[][]>((partial, segment) => partial.flatMap(prefix =>
        segment.kind === 'static' ? [[...prefix, segment.text]]
            : segment.kind === 'param' ? values.map(v => [...prefix, v])
                : Array.from({ length: limit }, (_, n) => n + 1).flatMap(n => tuples(values, n).map(t => [...prefix, ...t]))
    ), [[]])
    const methods = METHODS.filter(m => (granted.method === 'ANY' || granted.method === m) && (target.method === 'ANY' || target.method === m))
    return methods.some(method => requests.some(request => glob.test(request.join('/')) && routeFor(routes, method, request) === other))
}

const tuples = (values: string[], n: number): string[][] =>
    n === 0 ? [[]] : tuples(values, n - 1).flatMap(t => values.map(v => [...t, v]))
