import * as aws from '@pulumi/aws'
import * as postgresql from '@pulumi/postgresql'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'
import { writeFileSync } from 'node:fs'

const config = new pulumi.Config()
const list = (name: string) => (config.get(name) ?? '').split(',').map(s => s.trim()).filter(Boolean)
const region = aws.config.requireRegion()
const port = 5432
const database = 'pulumi_state'
/** Where CI's open-state-db step puts the RDS certificate bundle; this program puts it there too. */
const CA = '/tmp/rds-ca.pem'

export = async () => {
    const bundle = await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem')
    if (!bundle.ok) throw new Error(`could not download the RDS certificate bundle: ${bundle.status}`)
    writeFileSync(CA, await bundle.text())

    const vpcId = config.get('vpcId') ?? aws.ec2.getVpcOutput({ default: true }).id
    // Rules CI opens are not this program's: an inline ingress list would remove them on each update.
    const group = new aws.ec2.SecurityGroup('database', {
        name: 'pulumi-state', description: 'The Pulumi state database', vpcId, egress: [], tags: { Name: 'pulumi-state' },
    })
    for (const cidr of list('adminCidrs')) {
        new aws.vpc.SecurityGroupIngressRule(`admin-${cidr}`, {
            securityGroupId: group.id, ipProtocol: 'tcp', fromPort: port, toPort: port, cidrIpv4: cidr, description: 'pulumi state admin',
        })
    }
    const subnetIds = list('subnetIds')
    const subnets = subnetIds.length > 0 ? new aws.rds.SubnetGroup('database', { subnetIds }) : undefined
    const parameters = new aws.rds.ParameterGroup('database', {
        family: 'postgres17', parameters: [{ name: 'rds.force_ssl', value: '1' }, { name: 'log_connections', value: '1' }],
    })

    // A hosted runner reaches it over the internet, so it is public; its group admits only who opens it.
    const db = new aws.rds.Instance('database', {
        identifier: config.get('identifier') ?? 'pulumi-state',
        engine: 'postgres', engineVersion: '17', instanceClass: config.get('instanceClass') ?? 'db.t4g.micro',
        allocatedStorage: 20, maxAllocatedStorage: 100, storageType: 'gp3', storageEncrypted: true,
        dbName: database, username: 'pulumi_admin', manageMasterUserPassword: true,
        publiclyAccessible: true, vpcSecurityGroupIds: [group.id], dbSubnetGroupName: subnets?.name, parameterGroupName: parameters.name,
        multiAz: config.getBoolean('multiAz') ?? false,
        backupRetentionPeriod: config.getNumber('backupDays') ?? 14, copyTagsToSnapshot: true,
        deletionProtection: true, skipFinalSnapshot: false, finalSnapshotIdentifier: 'pulumi-state-final',
        autoMinorVersionUpgrade: true,
    }, { protect: true })

    const key = new aws.kms.Key('secrets', { description: 'Encrypts the secrets in Pulumi state', enableKeyRotation: true, deletionWindowInDays: 30 }, { protect: true })
    const alias = new aws.kms.Alias('secrets', { name: 'alias/pulumi-state', targetKeyId: key.keyId })

    const adminPassword = aws.secretsmanager.getSecretVersionOutput({ secretId: db.masterUserSecrets[0].secretArn })
        .secretString.apply(s => pulumi.secret(JSON.parse(s).password as string))
    const provider = new postgresql.Provider('admin', {
        host: db.address, port, database, username: db.username, password: adminPassword,
        sslmode: 'verify-full', sslrootcert: CA, superuser: false, connectTimeout: 15,
    })

    // The backend creates its table each time it opens; logging in as the owner makes the owner own it.
    const owner = new postgresql.Role('owner', { name: 'pulumi_state_owner', login: false }, { provider })
    new postgresql.Grant('owner-schema', { database, role: owner.name, schema: 'public', objectType: 'schema', privileges: ['CREATE', 'USAGE'] }, { provider })
    new postgresql.GrantRole('admin-owner', { role: db.username, grantRole: owner.name }, { provider })
    const ciPassword = new random.RandomPassword('ci', { length: 40, special: false })
    const ci = new postgresql.Role('ci', {
        name: 'pulumi_ci', login: true, password: ciPassword.result, roles: [owner.name], assumeRole: owner.name,
    }, { provider })

    const statements = [
        { Sid: 'Secrets', Effect: 'Allow', Action: 'kms:Decrypt', Resource: key.arn },
        { Sid: 'OpenTheDatabase', Effect: 'Allow', Action: ['ec2:AuthorizeSecurityGroupIngress', 'ec2:RevokeSecurityGroupIngress'], Resource: group.arn },
        { Sid: 'FindTheDatabase', Effect: 'Allow', Action: ['ec2:DescribeSecurityGroups', 'ec2:DescribeSecurityGroupRules'], Resource: '*' },
    ]
    for (const role of list('deployRoles')) {
        new aws.iam.RolePolicy(`deploy-${role}`, { role, name: 'pulumi-state', policy: pulumi.jsonStringify({ Version: '2012-10-17', Statement: statements }) })
    }

    return {
        backendUrl: pulumi.secret(pulumi.interpolate`postgres://${ci.name}:${ciPassword.result}@${db.address}:${port}/${database}?sslmode=verify-full&sslrootcert=${CA}`),
        secretsProvider: pulumi.interpolate`awskms://${alias.name}?region=${region}`,
        securityGroup: group.id,
        adminSecret: db.masterUserSecrets[0].secretArn,
    }
}
