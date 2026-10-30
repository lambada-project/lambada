import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export const input = (name, fallback) => process.env[`INPUT_${name.toUpperCase()}`] || fallback
export const aws = (...args) => execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
export const save = (name, value) => appendFileSync(process.env.GITHUB_STATE, `${name}=${value}\n`)
export const saved = name => process.env[`STATE_${name}`]
export const fail = message => { console.log(`::error::${message}`); process.exit(1) }
/** Rules this action adds say so, and when: `pulumi state: <repo>#<run> <ISO time>`. */
export const PREFIX = 'pulumi state: '
export const permission = (ip, port) =>
    JSON.stringify([{ IpProtocol: 'tcp', FromPort: Number(port), ToPort: Number(port), IpRanges: [{ CidrIp: `${ip}/32` }] }])
