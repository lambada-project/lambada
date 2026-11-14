---
title: Testing against AWS Emulator
sidebar_label: Testing
slug: /testing
---

## What the setup creates

`ConfigureAwsEnvironment` creates the tables and the keys that the config names, and sets the `envKeyName` of each one. `RemoveResources` deletes them.

A table is created with `PAY_PER_REQUEST`, and the setup returns when the table and each of its global secondary indexes are `ACTIVE`. A store that enforces provisioned throughput does not throttle a test, and a store that activates a table late does not fail the first test.

This page covers DynamoDB and KMS. Those are the services that were run against AWS Emulator.

## Point the setup at AWS Emulator

Each service takes its own client config under `aws`. Give each service the endpoint of the emulator, one region, and credentials:

```ts
import { ConfigureAwsEnvironment, RemoveResources } from '@lambada/core'

const emulator = {
    endpoint: 'https://127.0.0.1:9297',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
}

const config = {
    options: { aws: { dynamodb: emulator, kms: emulator }, tables, keys },
}

beforeAll(() => ConfigureAwsEnvironment(config))
afterAll(() => RemoveResources(config))
```

The clients of your own code need the same endpoint. The setup configures only its own clients.

## Start the emulator

Start the emulator on `127.0.0.1` with telemetry and authentication off:

```bash
EMULATOR_TELEMETRY=off aws-emulator -b 127.0.0.1 -p 9297 --telemetry off --auth off
```

With `--auth off` the emulator accepts any credentials, so the dummy values above are enough.

## Trust its certificate

The emulator serves HTTPS only. It writes a new certificate authority at each start, to `~/.aws/emulator/9297/ca.pem`. The certificate names `localhost`, `127.0.0.1` and `::1`, so the test process must run where those names reach the emulator.

Set `NODE_EXTRA_CA_CERTS` to that file before the test process starts, and after the emulator has started. A value from an earlier start names a certificate authority that no longer exists.

Bun reads only the first certificate of a file that holds several.

## Reset the state

The emulator has no reset route. Two ways reset it:

- Call `RemoveResources` with the same config. It deletes the tables and the keys of the config, and waits until the tables are gone.
- Restart the emulator. Set `NODE_EXTRA_CA_CERTS` again after the restart.

Call `RemoveResources` between test files, and restart the emulator between runs.
