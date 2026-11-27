---
title: Buckets
sidebar_label: Buckets
slug: /buckets
description: Declare S3 buckets, grant them whole or by key prefix, and serve them through CloudFront.
---

A bucket is declared under `buckets` by the name grants use. A function can be granted the whole bucket, or only the objects under one prefix. A bucket can also be served to the public through its own CloudFront distribution.

## A bucket and its key spaces

A bucket is declared under `buckets` and granted by name. A grant reaches the bucket and every object in it, and publishes the bucket's name as `envKeyName`.

A bucket whose objects belong to different writers declares its key spaces under `prefixes`, each by the name a grant uses:

```ts
run('pets', environment, {
    buckets: {
        photos: {
            name: 'pet-photos',
            envKeyName: 'PHOTOS_BUCKET',
            prefixes: { profilePhotos: 'profiles/', visitPhotos: 'visits/' },
        },
    },
    api: {
        endpointDefinitions: [{
            name: 'uploadProfilePhoto', path: '/pets/{id}/photo', method: 'POST', callbackDefinition,
            resources: { bucket: { profilePhotos: ['s3:PutObject'] } },
        }],
    },
})
```

- A prefix grant reaches only the objects whose keys start with the prefix: `s3:PutObject` on `arn:aws:s3:::pet-photos-dev/profiles/*`. It publishes the bucket's `envKeyName`, as a bucket grant does.
- `s3:ListBucket`, `s3:ListBucketVersions` and `s3:ListBucketMultipartUploads` are granted on the bucket, held to the prefix by the `s3:prefix` condition: the function lists `profiles/` and nothing else.
- Any other action on the bucket itself, such as `s3:GetBucketLocation`, would reach the whole bucket, so a prefix grant naming one is refused: grant the bucket for it.
- A prefix's key shares the namespace of the buckets: no prefix may share a key with a bucket or another prefix. A prefix is not empty, holds no `*` or `?`, and does not start with `/`.

A referenced bucket under `bucketsRef` may declare `prefixes` too.

## Served through CloudFront

A bucket with `cdn` is served by a distribution lambada builds in front of it. That distribution is the only reader the bucket lets in from outside:

```ts
photos: {
    name: 'pet-photos',
    envKeyName: 'PHOTOS_BUCKET',
    prefixes: { profilePhotos: 'profiles/', visitPhotos: 'visits/' },
    cdn: { prefixes: ['profilePhotos'], envKeyName: 'PHOTOS_CDN' },
},
```

- lambada creates an origin access control and the distribution, and adds to the bucket's policy one statement letting `cloudfront.amazonaws.com` read objects, for requests whose `AWS:SourceArn` is that distribution.
- Whatever the distribution may read is public: anyone with an object's URL fetches it, with no viewer authentication. Serve only what is meant for everyone, and keep private objects in prefixes the distribution does not read.
- `cdn.prefixes` names the prefixes the distribution may read, by key. Left out, it reads every object; an empty list is refused, so an allowlist that empties does not open the bucket. An object outside them answers 403 through the distribution.
- `cdn.envKeyName` publishes the distribution's domain to every function granted the bucket or one of its prefixes, so a function can build the URL of an object it wrote.
- The distribution only reads: GET and HEAD, HTTPS, with AWS's managed caching policy. `cdn.options` is merged over what lambada writes, for a custom domain or another cache policy, and `cdn.options.defaultCacheBehavior` field by field over lambada's behavior, so it names only what it changes. A field set to `undefined` keeps lambada's value. A behavior with `forwardedValues` takes no cache policy from lambada, as CloudFront accepts only one of them. lambada sets `compress: true`, so a behavior that should not compress says `compress: false`. The one origin's id is `bucket`.
- `cdn.cors: true` lets a page on any origin read the served objects, as a browser's `fetch` of an image does. lambada adds a response headers policy that answers every GET and HEAD with `Access-Control-Allow-Origin: *` and allows every request header. AWS's managed CORS policies allow no request headers, so CloudFront leaves out the CORS headers when a browser sends a header such as `priority`. A request the browser preflights with OPTIONS isn't answered. `cdn.cors` can't be combined with a `responseHeadersPolicyId` in `cdn.options`.
- The distribution has no `s3:ListBucket`, so a missing object answers 403, not 404.
- The statement goes in the policy hardening writes. The policy blocks no less: public access stays blocked, because a statement that names one distribution is not public. A bucket with `hardened: false` and a `cdn` gets a policy holding only that statement.
- A referenced bucket cannot have a `cdn`: its policy belongs to the stack that owns it.

The bucket's policy is written by lambada whenever it is hardened or has a `cdn`, so it cannot also come through `options.policy`.
