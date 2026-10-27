---
title: Buckets
sidebar_label: Buckets
slug: /buckets
---

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
- `cdn.prefixes` names the prefixes the distribution may read, by key. Left out, it reads every object. An object outside them answers 403 through the distribution.
- `cdn.envKeyName` publishes the distribution's domain to every function granted the bucket or one of its prefixes, so a function can build the URL of an object it wrote.
- The distribution only reads: GET and HEAD, HTTPS, with AWS's managed caching policy. `cdn.options` is merged over what lambada writes, for a custom domain or another cache policy. The one origin's id is `bucket`.
- The distribution has no `s3:ListBucket`, so a missing object answers 403, not 404.
- The statement goes in the policy hardening writes. The policy blocks no less: public access stays blocked, because a statement that names one distribution is not public. A bucket with `hardened: false` and a `cdn` gets a policy holding only that statement.
- A referenced bucket cannot have a `cdn`: its policy belongs to the stack that owns it.

The bucket's policy is written by lambada whenever it is hardened or has a `cdn`, so it cannot also come through `options.policy`.
