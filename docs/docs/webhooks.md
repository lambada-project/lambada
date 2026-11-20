---
title: Webhooks
sidebar_label: Webhooks
slug: /webhooks
description: Accept a webhook with an immediate 200 and process it from a FIFO queue, with retries.
---

A webhook sender wants a fast answer and retries when it doesn't get one. A webhook endpoint answers right away and processes the request later: the request is put on a FIFO queue, and your callback runs from the queue, where a failure is retried instead of lost.

Any endpoint becomes one with `webhook: { wrapInQueue: true }`:

```ts
api: {
    endpointDefinitions: [{
        name: 'stripeEvents',
        path: '/webhooks/stripe',
        method: 'POST',
        auth: { authorizer: false },          // public: the sender has no token. Leave auth out if the stack declares no auth.authorizers
        webhook: {
            wrapInQueue: true,
            options: { visibilityTimeoutSeconds: 120 },
        },
        lambdaOptions: { timeout: 60 },
        resources: {
            table: { payments: ['dynamodb:PutItem'] },
            envVar: ['STRIPE_WEBHOOK_SECRET'],
        },
        callbackDefinition: async ({ request }) => {
            // Runs from the queue, after the sender got its 200.
            verifySignature(request.headers['Stripe-Signature'], request.body, process.env.STRIPE_WEBHOOK_SECRET)
            await recordPayment(JSON.parse(request.body ?? '{}'))
            return {}
        },
    }],
}
```

## What lambada builds

| Resource | Name | Does |
| --- | --- | --- |
| FIFO queue | `<name>-<environment>.fifo` | Holds requests, with content-based deduplication. |
| Ingress function | `<name>-webhook` | Serves the route, puts the request on the queue and answers `200`. Its IAM allows only sending to the queue. It receives the stack's whole `environmentVariables` pool. |
| Handler function | `<name>-handler` | Receives one message at a time and calls your `callbackDefinition` with the original request. It gets the endpoint's `resources` and `environmentVariables`. |

The callback receives the same `{ user, request }` an ordinary endpoint does, rebuilt from the queue message. Its return value is ignored. A thrown error leaves the message on the queue, and SQS delivers it again after the visibility timeout.

## Timeouts

Both functions default to a **30-second** timeout, not the usual 90, and `api.lambdaDefaultOptions.timeout` doesn't change that: set `lambdaOptions.timeout` on the webhook itself. The queue's `visibilityTimeoutSeconds` (30 by default) must be at least the timeout, or the stack is refused:

```text
Queue visibilityTimeoutSeconds (30) must be greater or equal than the endpoint's timeout (60).
```

## Options

| Field | Description |
| --- | --- |
| `webhook.wrapInQueue` | `true` to queue the request. |
| `webhook.options` | Pulumi `aws.sqs.QueueArgs` for the queue: `visibilityTimeoutSeconds`, `messageRetentionSeconds`, `redrivePolicy`… FIFO and content-based deduplication are always on. |
| `auth` | Applies to the ingress route, as on any [endpoint](http-api#authorization). |

:::tip Send failures somewhere
Without a `redrivePolicy`, a message that keeps failing is retried until the queue's retention period ends (4 days by default). Give the queue a dead-letter queue to keep the ones that never succeed.
:::

## Limits

- **Messages are processed one at a time, in order.** Every message currently goes to one message group, so a slow or failing message holds up the ones behind it.
- **Verification happens after the 200.** A signature check in the callback can reject a forged request, but the sender has already been told it succeeded.
- Webhooks are never deployed from [bundles](bundles), and `extraHeaders` and `cache` don't apply to the ingress.
- The ingress answers `200` with a small JSON body. A sender that requires another status or an empty body isn't served.
- With [OpenAPI](http-api#openapi), a webhook is listed under `webhooks`, not `paths`.
