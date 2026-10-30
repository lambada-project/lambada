# @lambada/state-migrate

Moves Pulumi stacks from Pulumi Cloud to a self-managed backend, such as Postgres, and rewrites the repo to match.

```sh
npx lambada-state plan ../shop ../catalog ../orders     # what moves, what changes, in which order
PULUMI_BACKEND_URL='postgres://…?sslmode=verify-full' PULUMI_ACCESS_TOKEN=… \
  npx lambada-state migrate ../shop --stack dev --secrets-provider 'awskms://alias/pulumi-state?region=us-east-1'
npx lambada-state rewrite ../shop                       # then open the PR
```

## What it does

`plan` reads each repo and reports, without changing anything:

- **Its projects and stacks**, and which of them Pulumi Cloud encrypts.
- **Stack references that name the Pulumi Cloud organization.** A self-managed backend has one organization, `organization`, and refuses any other name: `organization name must be 'organization'`. These are references written in code and the config values passed to them.
- **Workflow logins**: every `PULUMI_ACCESS_TOKEN` it renames, and the secrets the workflows will then read.
- **Jobs running Pulumi without a `concurrency` group.**
- **Names the Postgres backend cannot hold.**
- **The order to move repos in.** A stack's references resolve in its own backend, so referenced projects move first. Repos referencing each other form a group that moves together.

`migrate` copies one stack, such as `dev`, of every project in a repo, and proves each copy:

1. Refuses a stack the target already holds, and a name with `_` or `%`.
2. Records the Pulumi Cloud version, then copies the stack with `pulumi stack migrate`, encrypting with the given secrets provider.
3. Compares the two exports resource by resource, with secrets decrypted, and every config value.
4. Reads the Pulumi Cloud version again. A deploy that landed meanwhile is copied over with `stack export` and `stack import`, then proven again. A stack that keeps moving is refused.

Pulumi Cloud is left as it was. The target's URL is read from the environment, never from an argument, and never with `pulumi login`, which writes it to `~/.pulumi/credentials.json` with its password.

`rewrite` makes the changes `plan` reports:

- **Code references** whose organization is spelled out are pointed at `organization`.
- **Config values** that references read are changed the same way.
- **`PULUMI_ACCESS_TOKEN`** is renamed to `PULUMI_BACKEND_URL` in workflows and local actions. This keeps however a workflow picks its token: one secret, one per environment, or a name built at run time.

`pulumi` and `pulumi/actions` read `PULUMI_BACKEND_URL`; the action's own `pulumi login` yields to it. Create the secrets `plan` lists before merging. References whose names are computed are reported, not rewritten.

## The order of a move

For each environment, in the order `plan` gives:

1. **Pause the repos' deploys** and copy their stacks with `migrate`.
2. **Make the Pulumi Cloud stacks read-only.**
3. **Create the backend URL secrets**, run `rewrite`, and open the PR. Its preview should show no changes.
4. **Keep the Pulumi Cloud stacks until the soak ends.** They are the way back.

A deploy to Pulumi Cloud after the copy and before step 2 leaves the copy behind. `migrate` catches the ones that land while it runs. Afterwards, the target's preview does not show the gap: it plans to create what Pulumi Cloud created, which then fails with "already exists".

To take the copy again:

1. Remove it with `pulumi stack rm --force -s <stack>` against the target. Its resources stay.
2. That also deletes `Pulumi.<stack>.yaml`, which the copy re-encrypted. Restore the Pulumi Cloud version, such as with `git checkout -- Pulumi.<stack>.yaml`.
3. Run `migrate` again.

Once both backends have deployed, neither preview shows it without `--refresh`, and the stacks must be reconciled by hand.

## The Postgres backend, measured

Measured with Pulumi 3.265 against RDS Postgres 17:

- **The copy matched Pulumi Cloud exactly.** Resources and outputs were the same, secrets decrypted to the same values, and preview and refresh showed no changes. This held with `passphrase` and with `awskms`.
- **Nothing is in plaintext at rest.** No secret, and not the database password, appears in the table.
- **Each checkpoint replaces one row.** An update killed mid-run left a readable state. Its lock and pending operations needed `pulumi cancel` and `pulumi refresh`, as they do on Pulumi Cloud.
- **Dropped connections are survived.** An update whose database connections were cut 15 times finished, with its state intact.
- **Two runs on one stack both fail.** In 28 of 30 rounds, both runs saw the other's lock and stopped; never did both run. A `concurrency` group per stack queues them instead.
- **`_` and `%` in a project or stack name are read as SQL wildcards.** A stack `a_b` next to a stack `aXb` crashes the CLI on every command, `stack rm` included.
- **`pulumi stack export --version` is not supported.** Every checkpoint is kept in the table; nothing deletes them.
- **An update makes about 190 SQL statements,** so the network between CI and the database shapes its speed.
- **End to end, two lambada services moved and kept deploying.** One referenced the other in code and through config. After `migrate` and `rewrite`, a run with only `PULUMI_BACKEND_URL` previewed no changes. Its updates reached both references, its secrets decrypted with KMS alone, and both APIs answered.
- **`pulumi/actions` writes the backend URL, password included, to `~/.pulumi/credentials.json`.** A GitHub-hosted runner discards it; a self-hosted runner keeps it.
