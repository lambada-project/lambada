/**
 * A self-managed backend has one organization, named `organization`: a stack reference naming the
 * Pulumi Cloud organization fails there ("organization name must be 'organization'"). These rewrite
 * the references a repo spells out, and report the ones it builds, which only its author can change.
 */

export type Change = { line: number, from: string, to: string }
export type Unresolved = { line: number, text: string, reason: string }
export type Rewrite = { text: string, changes: Change[], unresolved: Unresolved[] }

const SELF_MANAGED_ORG = 'organization'
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

/** `new StackReference(<literal>` in code: the literal's quote and its text up to the closing quote. */
const REFERENCE = /StackReference\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const CONFIG_REFERENCE = /StackReference\(\s*(?:[\w.]+\.)?(?:config\.)?(?:require|get)(?:Secret)?\(\s*['"]([^'"]+)['"]/g

/** The config keys whose values name a stack to reference, for `rewriteConfig`. */
export const referenceConfigKeys = (source: string): string[] =>
    [...source.matchAll(CONFIG_REFERENCE)].map(m => m[1])

export const rewriteCode = (source: string, org: string): Rewrite => {
    const changes: Change[] = []
    const unresolved: Unresolved[] = []
    const prefix = new RegExp(`^${escape(org)}/`)
    const text = source.replace(REFERENCE, (match, quote: string, name: string, index: number) => {
        const line = lineOf(source, index)
        if (prefix.test(name)) {
            const to = name.replace(prefix, `${SELF_MANAGED_ORG}/`)
            changes.push({ line, from: name, to })
            return match.replace(`${quote}${name}${quote}`, `${quote}${to}${quote}`)
        }
        if (quote === '`' && /^\$\{/.test(name)) unresolved.push({ line, text: name, reason: 'the organization is computed; make it resolve to \'organization\'' })
        return match
    })
    for (const m of source.matchAll(/StackReference\(\s*(?=\S)(?!['"`])(?!(?:[\w.]+\.)?(?:config\.)?(?:require|get)(?:Secret)?\()([^)\n]*)/g)) {
        unresolved.push({ line: lineOf(source, m.index), text: m[1].trim(), reason: 'the name is computed; make its organization resolve to \'organization\'' })
    }
    // A name built away from the reference, such as a constant passed in. The organization is often also a
    // GitHub or registry owner, so these are reported, not rewritten.
    const rewritten = new Set(changes.map(c => c.line))
    for (const m of text.matchAll(new RegExp(`(['"\`])${escape(org)}/[^/\\s'"\`]+/[^'"\`\\s]+\\1`, 'g'))) {
        const line = lineOf(text, m.index)
        if (!rewritten.has(line)) unresolved.push({ line, text: m[0], reason: 'it may name a stack; if it does, change its organization to \'organization\'' })
    }
    return { text, changes, unresolved }
}

/** Stack settings: plain values of `keys` naming `<org>/<project>/<stack>`. Secret values are left, and reported. */
export const rewriteConfig = (yaml: string, org: string, keys: string[]): Rewrite => {
    const changes: Change[] = []
    const unresolved: Unresolved[] = []
    const names = keys.map(k => k.includes(':') ? k.slice(k.indexOf(':') + 1) : k)
    const entry = new RegExp(`^(\\s+)([\\w-]+:)?(${names.map(escape).join('|')}):[ \\t]*(["']?)(${escape(org)})/([^/\\s"']+/[^/\\s"']+)\\4[ \\t]*$`, 'gm')
    const text = names.length === 0 ? yaml : yaml.replace(entry, (match, indent, ns = '', key, quote, _org, rest, index: number) => {
        changes.push({ line: lineOf(yaml, index), from: `${org}/${rest}`, to: `${SELF_MANAGED_ORG}/${rest}` })
        return `${indent}${ns}${key}: ${quote}${SELF_MANAGED_ORG}/${rest}${quote}`
    })
    for (const m of yaml.matchAll(new RegExp(`^\\s+(?:[\\w-]+:)?(${names.map(escape).join('|') || '(?!)'}):\\s*\\n\\s+secure:`, 'gm'))) {
        unresolved.push({ line: lineOf(yaml, m.index), text: m[1], reason: 'the reference is a secret; set it again with the organization \'organization\'' })
    }
    return { text, changes, unresolved }
}
