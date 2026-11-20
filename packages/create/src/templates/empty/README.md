# {{PROJECT_NAME}}

A [Lambada](https://lambada-project.github.io) stack: a small to-do API on API Gateway, Lambda and DynamoDB.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The stack: one `run()` call declaring the table and the endpoints |
| `src/resources.ts` | The table, kept apart so tests create the same one |
| `src/api/todos.ts` | The handlers |
| `src/api/todos.test.ts` | Tests, run against AWS Emulator |

## Develop

Open the folder in VS Code and choose **Reopen in Container**. The devcontainer has Node 24, the Pulumi CLI, the AWS CLI, Bun and AWS Emulator, and mounts your `~/.aws` read-only.

Without the devcontainer, install those tools yourself.

```bash
npm test            # starts AWS Emulator, runs the tests, stops it
npm run typecheck
```

## Deploy

```bash
pulumi login                  # or: pulumi login --local
pulumi stack init dev         # region: Pulumi.dev.yaml
pulumi up
curl "$(pulumi stack output apiUrl)api/health"
```

`dependencies` are uploaded with every function. Keep deploy-time packages, such as `@lambada/core` and `@pulumi/*`, in `devDependencies`.

Next: the [Lambada docs](https://lambada-project.github.io/concepts).
