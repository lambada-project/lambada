---
title: Static sites and CDN
sidebar_label: Static sites & CDN
slug: /static-sites
description: Serve a built frontend next to the API, and put CloudFront in front of both.
---

A stack can serve a built frontend, such as a Vite or React build folder, from the same API Gateway as its endpoints, and put one CloudFront distribution in front of both. The site and the API then share an origin, and the browser needs no CORS.

```ts
const result = run('todos', environment, {
    api: { endpointDefinitions },
    staticSiteLocalPath: 'web/dist',
    cdn: { useCDN: true, isSpa: true },
})

export const siteUrl = result.cdn && pulumi.interpolate`https://${result.cdn.domainName}`
```

## The static site

`staticSiteLocalPath` uploads a local folder and serves it under `/www` on the API (`naming.wwwPath`). Build the frontend before `pulumi up`: the folder is read when the stack is deployed.

The site needs at least one endpoint: a stack without an API serves neither the site nor the CDN.

## The distribution

`cdn: { useCDN: true }` builds a CloudFront distribution with two behaviours:

| Path | Origin | Caching |
| --- | --- | --- |
| `/api/*` | the API stage | Up to 60 seconds by default, varying on the query string, cookies and the `Authorization`, `Origin` and `Cache-Control` headers. All methods. |
| everything else | the static site | Up to 60 seconds by default. GET, HEAD and OPTIONS. |

A request outside `/api` is rewritten to `/index.html` unless it ends in a known asset extension: `.js`, `.css`, `.html`, `.json`, `.map`, `.wasm`, images, fonts, audio and video. A single-page app's client-side routes then load the app. A file with another extension, such as `.txt` or `.pdf`, is answered with `index.html` too.

:::caution API caching
CloudFront may serve a cached `GET` under `/api` for up to a minute. Send `Cache-Control: no-store` from endpoints whose answers must always be fresh: add it with `cache: { control: 'no-store' }`.
:::

### A custom domain

```ts
cdn: {
    useCDN: true,
    isSpa: true,
    customDomain: {
        domainWithCert: '*.example.com',     // an issued ACM certificate in us-east-1
        aliases: ['todos.example.com'],
    },
}
```

lambada looks up the certificate in `us-east-1`, where CloudFront requires it, and sets the aliases. It creates no DNS records: point a CNAME, or a Route 53 alias, at `result.cdn.domainName`.

### Options

| Field | Description |
| --- | --- |
| `useCDN` | Builds the distribution. |
| `isSpa` | Required by the type. The rewrite to `/index.html` happens either way. |
| `entrypoint` | Currently has no effect. |
| `customDomain` | `{ domainWithCert, aliases }`, as above. |

:::note Stage name
The distribution finds the API under the stage named by `naming.stageName` (`app`). If you rename the stage with `api.stage.name`, set `naming.stageName` to the same value.
:::

## Serving files from a bucket

To serve user uploads or other objects from S3 rather than a build folder, declare a [bucket with a `cdn`](buckets#served-through-cloudfront). It gets its own distribution, which reads only the prefixes you allow.
