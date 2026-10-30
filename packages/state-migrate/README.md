# @lambada/state-migrate

Moves Pulumi stacks from Pulumi Cloud to a self-managed backend, such as Postgres, and rewrites the repo to match.

```sh
lambada-state plan ../shop ../catalog ../orders     # what moves, what changes, in which order
PULUMI_BACKEND_URL='postgres://…?sslmode=verify-full' PULUMI_ACCESS_TOKEN=… \
  lambada-state migrate ../shop --stack dev --secrets-provider 'awskms://alias/pulumi-state?region=us-east-1'
lambada-state rewrite ../shop                       # then open the PR
```

## Running it

`@lambada/state-migrate` is not on npm yet. From a checkout of this repo:

```sh
npm install && npm run build -w packages/state-migrate
node packages/state-migrate/dist/cli.js --help
```

`npm link` in `packages/state-migrate` puts `lambada-state` on `PATH`, as the examples use it.

It needs Node 22 or later and the `pulumi` CLI on `PATH`. Every command takes `--org <name>`, the Pulumi Cloud organization, or reads it from `PULUMI_ACCESS_TOKEN`. `migrate` also takes `--stack` and `--secrets-provider`, and reads the target from `PULUMI_BACKEND_URL`.

`plan` and `rewrite` mark each line of their output:

- `~ file:line`: a change `rewrite` makes.
- `? file:line`: something to change by hand, with the reason.
- `✗`: a problem that stops the move.

A command exits 1 when `plan` finds a problem, or when it fails or refuses; otherwise it exits 0.

## What it does

`plan` reads each repo and reports, without changing anything:

- **Its projects and stacks**, and which of them Pulumi Cloud encrypts.
- **Stack references that name the Pulumi Cloud organization.** A self-managed backend has one organization, `organization`, and refuses any other name: `organization name must be 'organization'`. These are references written in code and the config values passed to them.
- **Workflow logins**: every `PULUMI_ACCESS_TOKEN` it renames, and the secrets the workflows will then read.
- **Jobs running Pulumi without a `concurrency` group.**
- **Jobs that will open the database to their runner**, and those with no AWS credentials before their first Pulumi step.
- **Names the Postgres backend cannot hold.**
- **The order to move repos in.** A stack's references resolve in its own backend, so referenced projects move first. Repos referencing each other form a group that moves together.

`migrate` copies one stack, such as `dev`, of every project in a repo, and proves each copy:

1. Refuses a stack the target already holds, and a name with `_` or `%`.
2. Records the Pulumi Cloud version, then copies the stack with `pulumi stack migrate`, encrypting with the given secrets provider.
3. Compares the two exports resource by resource, with secrets decrypted, and every config value.
4. Reads the Pulumi Cloud version again. A deploy that landed meanwhile is copied over with `stack export` and `stack import`, then proven again. A stack that keeps moving is refused.

`pulumi stack migrate` rewrites `Pulumi.<stack>.yaml` for the new secrets provider and keeps the Pulumi Cloud version beside it as `Pulumi.<stack>.yaml.bak.<n>`. The rewritten file belongs in the PR; the backup does not.

Pulumi Cloud is left as it was. The target's URL is read from the environment, never from an argument, and never with `pulumi login`, which writes it to `~/.pulumi/credentials.json` with its password.

`rewrite` makes the changes `plan` reports:

- **Code references** whose organization is spelled out are pointed at `organization`. A reference's stack is its `name` option when it has one, otherwise its first argument.
- **Config values** that references read are changed the same way.
- **`PULUMI_ACCESS_TOKEN`** is renamed to `PULUMI_BACKEND_URL` in workflows and local actions. This keeps however a workflow picks its token: one secret, one per environment, or a name built at run time.
- **The step opening the database** goes right before each job's first Pulumi step: a `pulumi` command, `pulumi/actions`, or a local action that runs either. `--state-action <uses>` names another step, and `--state-action none` adds none, for runners inside the database's network.

A new reference names `organization/<project>/<stack>`, or only `<stack>` within its own project. `<project>/<stack>` fails, as does the Pulumi Cloud organization.

`pulumi` and `pulumi/actions` read `PULUMI_BACKEND_URL`; the action's own `pulumi login` yields to it. Create the secrets `plan` lists before merging. References whose names are computed are reported, not rewritten.

## The order of a move

For each environment, in the order `plan` gives:

1. **Pause the repos' deploys** and copy their stacks with `migrate`.
2. **Make the Pulumi Cloud stacks read-only** by revoking the Pulumi tokens their workflows use, or deleting the `PULUMI_ACCESS_TOKEN` secrets. Nothing on the Pulumi side holds: an update held open blocks others only until its lease expires, about 5 minutes, and a renamed stack still answers to its old name.
3. **Create the backend URL secrets**, run `rewrite`, and open the PR with the rewritten `Pulumi.<stack>.yaml` files. Its preview should show no changes. CI then needs to reach the database and to decrypt with the KMS key.
4. **Keep the Pulumi Cloud stacks until the soak ends.** They are the way back.

A deploy to Pulumi Cloud after the copy and before step 2 leaves the copy behind. `migrate` catches the ones that land while it runs. Afterwards, the target's preview does not show the gap: it plans to create what Pulumi Cloud created, which then fails with "already exists".

To take the copy again:

1. Remove it with `pulumi stack rm --force -s <stack>` against the target. Its resources stay.
2. That also deletes `Pulumi.<stack>.yaml`, which the copy re-encrypted. Restore the Pulumi Cloud version, such as with `git checkout -- Pulumi.<stack>.yaml`.
3. Run `migrate` again.

Once both backends have deployed, neither preview shows it without `--refresh`, and the stacks must be reconciled by hand.

## The database and CI

Each AWS account gets its own database, from the template in [`database`](database/index.ts). Keep the template's own state on Pulumi Cloud or in S3, never in the database it makes:

```sh
pulumi new https://github.com/lambada-project/lambada/tree/main/packages/state-migrate/database
pulumi up
pulumi stack output backendUrl --show-secrets | tr -d "\n"   # the PULUMI_BACKEND_URL secret, without a newline
pulumi stack output secretsProvider             # --secrets-provider for migrate
```

It makes:

- **A Postgres instance** that refuses unencrypted connections, with deletion protection, 14 days of point-in-time recovery, a final snapshot, and its admin password in Secrets Manager. Pulumi protects it too.
- **A security group named `pulumi-state`** admitting `adminCidrs` and whatever runners open it. Its ingress rules are resources of their own, so an update leaves the runners' rules alone.
- **A KMS key**, `alias/pulumi-state`, with rotation on, for the secrets provider.
- **The login `pulumi_ci`**, and a policy on each of `deployRoles` letting it open the database and decrypt.

`vpcId` and `subnetIds` place it outside the default VPC; `multiAz`, `instanceClass`, `backupDays` and `identifier` change the rest.

The backend runs `CREATE TABLE IF NOT EXISTS` each time it opens, so its login needs `CREATE` on the schema and must own `pulumi_state`. A login that may only read and write rows cannot open it. The template keeps the owner apart from the login:

```sql
CREATE ROLE pulumi_state_owner NOLOGIN;
GRANT CREATE, USAGE ON SCHEMA public TO pulumi_state_owner;
GRANT pulumi_state_owner TO pulumi_admin;
CREATE ROLE pulumi_ci LOGIN PASSWORD '…' IN ROLE pulumi_state_owner;
ALTER ROLE pulumi_ci SET ROLE pulumi_state_owner;   -- the table it creates belongs to the owner
```

`pulumi_ci` deploys and cannot create roles or databases. It can drop the table, which is why each account has its own database, with point-in-time recovery and deletion protection.

For `sslmode=verify-full`, the URL names the RDS certificate bundle at `/tmp/rds-ca.pem`, as `sslrootcert=/tmp/rds-ca.pem`. The URL holds the password; GitHub masks the secret as a whole, but `pulumi/actions` prints the URL's host in its login line.

A GitHub-hosted runner leaves from Azure, from an address no security group can list in advance. The step `rewrite` adds, [`open-state-db`](../../.github/actions/open-state-db/action.yml), lets the runner's `/32` into the database's security group, and removes it after the job, even a failed one:

```yaml
- uses: lambada-project/lambada/.github/actions/open-state-db@state-db-v1
  with:
    security-group: pulumi-state   # its ID, or its Name tag (the default)
```

It also downloads the certificate bundle to `/tmp/rds-ca.pem`, and, when `PULUMI_BACKEND_URL` is in the job's environment, masks the database's host and waits until the database answers. A rule a cancelled run left behind is removed by the next run, after six hours. Set the URL in the job's `env:` rather than a step's, so the step sees it.

It runs with the job's AWS credentials, so it follows the credentials step. The role needs `ec2:AuthorizeSecurityGroupIngress` and `ec2:RevokeSecurityGroupIngress` on the database's group, `ec2:DescribeSecurityGroups` and `ec2:DescribeSecurityGroupRules`, and `kms:Decrypt` on the secrets provider's key; it needs no `kms:Encrypt`.

## Going back to Pulumi Cloud

After the target has deployed, its state returns to the same Pulumi Cloud stack, which keeps its history:

1. Export from the target: `pulumi stack export -s <stack> > state.json`.
2. Restore the Pulumi Cloud `Pulumi.<stack>.yaml`, then set in it every config value the target deployed with.
3. Import into Pulumi Cloud: `pulumi stack import --file state.json -s <org>/<project>/<stack>`.

Secrets are re-encrypted for Pulumi Cloud on import. The returned stack matched the target resource by resource, and its preview and refresh showed no changes.

## Operating the database

- **Point-in-time restore** brings back the table as it was. A stack in the restored copy is behind the resources by every update since; one `pulumi up --refresh` catches it up. A restore took 12 minutes.
- **History can be pruned with SQL.** Rows under `.pulumi/history/<project>/<stack>/` and `.pulumi/backups/<project>/<stack>/` can be deleted, newest kept; the stack still previews with no changes and records later updates.
- **A password change takes effect at once.** The old URL is refused at its next connection, so update every repo's secret together.

## The Postgres backend, measured

Measured with Pulumi 3.265 against RDS Postgres 17:

- **The copy matched Pulumi Cloud exactly.** Resources and outputs were the same, secrets decrypted to the same values, and preview and refresh showed no changes. This held with `passphrase` and with `awskms`.
- **Nothing is in plaintext at rest.** No secret, and not the database password, appears in the table.
- **Each checkpoint replaces one row.** An update killed mid-run left a readable state. Its lock and pending operations needed `pulumi cancel` and `pulumi refresh`, as they do on Pulumi Cloud.
- **Dropped connections are survived.** An update whose database connections were cut 15 times finished, with its state intact.
- **Two runs on one stack both fail.** In 28 of 30 rounds, both runs saw the other's lock and stopped; never did both run. A `concurrency` group per stack queues them instead.
- **`_` and `%` in a project or stack name are read as SQL wildcards.** A stack `a_b` next to a stack `aXb` crashes the CLI on every command, `stack rm` included.
- **`pulumi stack export --version` is not supported.** Every checkpoint is kept in the table until pruned.
- **An update makes about 190 SQL statements,** so the network between CI and the database shapes its speed.
- **End to end, two lambada services moved and kept deploying.** One referenced the other in code and through config. After `migrate` and `rewrite`, a run with only `PULUMI_BACKEND_URL` previewed no changes. Its updates reached both references, its secrets decrypted with KMS alone, and both APIs answered.
- **`pulumi/actions` writes the backend URL, password included, to `~/.pulumi/credentials.json`.** A GitHub-hosted runner discards it; a self-hosted runner keeps it.
- **The template made a working database from scratch in about 10 minutes**, and a second update changed nothing. Its login's session ran as `pulumi_state_owner`, so the table the backend created belonged to the owner; it deployed with KMS secrets; a rule a runner had added survived the template's update; and protect refused a destroy.
- **A GitHub-hosted runner deployed a lambada service through the backend.** It opened the database to itself, decrypted with `kms:Decrypt` alone, resumed an update an earlier run had left half done, and a second run previewed no changes.
