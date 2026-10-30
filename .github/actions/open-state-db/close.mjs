import { aws, permission, saved } from './state.mjs'

if (saved('opened') === 'true') {
    try {
        aws('ec2', 'revoke-security-group-ingress', '--group-id', saved('group'), '--ip-permissions', permission(saved('ip'), process.env.INPUT_PORT || '5432'))
        console.log(`closed ${saved('group')}`)
    } catch (e) {
        console.log(`::warning::could not close ${saved('group')} to ${saved('ip')}: ${String(e.stderr).trim()}`)
    }
}
