# @lambada/create

Creates a [Lambada](https://lambada-project.github.io) project.

```bash
npm init @lambada my-app     # creates ./my-app
npm init @lambada            # uses the current directory, which must be empty
```

The project is a small to-do API (API Gateway, Lambda and DynamoDB) with:

- a devcontainer with Node 24, the Pulumi CLI, the AWS CLI, Bun and AWS Emulator;
- tests that run against AWS Emulator with `npm test`;
- a `dev` stack ready for `pulumi up`.

Requires Node 20 or newer.

### Special thanks

- Lots of copy-pasta from https://github.com/pixelmund/create-svelte-app
