// A hosted runner leaves from an address no security group can list in advance, so the job opens
// the database to its own address and the post step closes it.
import { writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { aws, fail, input, permission, PREFIX, save } from './state.mjs'

const port = input('port', '5432')
const ip = (await (await fetch('https://checkip.amazonaws.com')).text()).trim()
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) fail(`could not tell this runner's address: '${ip}'`)

const wanted = input('security-group', 'pulumi-state')
let group = wanted
if (!/^sg-[0-9a-f]+$/.test(wanted)) {
    const found = JSON.parse(aws('ec2', 'describe-security-groups', '--filters', `Name=tag:Name,Values=${wanted}`)).SecurityGroups
    if (found.length !== 1) fail(`${found.length} security groups are named '${wanted}'; pass security-group as an ID`)
    group = found[0].GroupId
}

// A cancelled runner never runs its post step: its rule is closed here once it is old enough that
// no job could still be using it.
const STALE_MS = 6 * 3600_000
const rules = JSON.parse(aws('ec2', 'describe-security-group-rules', '--filters', `Name=group-id,Values=${group}`)).SecurityGroupRules
const stale = rules.filter(r => !r.IsEgress && r.Description?.startsWith(PREFIX) && Date.now() - Date.parse(r.Description.split(' ').pop()) > STALE_MS)
if (stale.length > 0) {
    aws('ec2', 'revoke-security-group-ingress', '--group-id', group, '--security-group-rule-ids', ...stale.map(r => r.SecurityGroupRuleId))
    console.log(`closed ${stale.length} rule(s) left open by runs more than 6 hours ago`)
}

const run = `${process.env.GITHUB_REPOSITORY}#${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT}`
const rule = JSON.parse(permission(ip, port))
rule[0].IpRanges[0].Description = `${PREFIX}${run} ${new Date().toISOString()}`.slice(0, 255)
try {
    aws('ec2', 'authorize-security-group-ingress', '--group-id', group, '--ip-permissions', JSON.stringify(rule))
    save('opened', 'true')
} catch (e) {
    // Another job on this address opened it; that job closes it.
    if (!String(e.stderr).includes('InvalidPermission.Duplicate')) fail(`could not open ${group}: ${String(e.stderr).trim()}`)
    console.log(`${group} already admits this runner`)
}
save('group', group)
save('ip', ip)

const bundle = await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem')
if (!bundle.ok) fail(`could not download the RDS certificate bundle: ${bundle.status}`)
writeFileSync(input('ca-bundle', '/tmp/rds-ca.pem'), await bundle.text())

// Pulumi cannot parse a URL with a newline, reads it as Pulumi Cloud, and asks for PULUMI_ACCESS_TOKEN.
if (/\s/.test(process.env.PULUMI_BACKEND_URL ?? '')) fail('PULUMI_BACKEND_URL holds whitespace, such as a trailing newline; set the secret again without it')
const host = /@([^:/?]+)/.exec(process.env.PULUMI_BACKEND_URL ?? '')?.[1]
if (!host) {
    console.log(`opened ${group}; PULUMI_BACKEND_URL is not set in this step, so the database was not tried`)
} else {
    // pulumi/actions prints the backend URL's host; the secret's mask covers the URL only as a whole.
    console.log(`::add-mask::${host}`)
    const reach = () => new Promise(resolve => {
        const socket = connect({ host, port: Number(port), timeout: 5000 })
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
        socket.once('error', () => resolve(false))
    })
    const deadline = Date.now() + 60_000
    while (!(await reach())) {
        if (Date.now() > deadline) fail(`opened ${group}, but the database did not answer on port ${port} within a minute`)
        await new Promise(r => setTimeout(r, 2000))
    }
    console.log(`opened ${group} to this runner; the database answers`)
}
