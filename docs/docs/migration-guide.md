---
id: migration-guide
title: Migration Guide
sidebar_label: Migration Guide
slug: /migration
---


## Index keys move to `keySchemas` (1.31)
`@lambada/core` 1.31 hands every table index to the AWS provider with `keySchemas`, which replaces the deprecated `hashKey` and `rangeKey`. On a table deployed before that, the stack's state still records `hashKey` and `rangeKey`. The provider then reads the index as a different one, and **deletes and recreates it**: queries on it fail until DynamoDB has backfilled it again. A `pulumi refresh` does not change that.

Patch each stack's state once, before its first deploy with 1.31 or later:

```bash
pulumi stack export > state.json
npx lambada-index-key-schemas < state.json > state.patched.json
pulumi stack import --file state.patched.json
pulumi preview --diff   # the tables show no change to globalSecondaryIndexes
```

The patch adds `keySchemas` next to `hashKey` and `rangeKey` for every index in the state, which is the state a deploy stating both forms leaves. After it:
- 1.31 deploys the indexes unchanged;
- a `pulumi refresh` keeps them unchanged;
- a deploy with an earlier version, which states `hashKey` and `rangeKey`, also deploys them unchanged.

The patch is safe to run twice, and it leaves an index that already records `keySchemas` as it is.

**Check the preview before deploying.** A table index showing `- hashKey` or `- rangeKey` will be recreated. The exception is a deploy that also adds or removes indexes: its preview redraws the untouched indexes with the same lines.

## From Attire to Lambada (March 2021)
### Core library is now `@lambada/core`
We keel the breaking changes to a minimum and this migration should not cause major issues. Just rename @attire to @lambada and follow the steps below:

### Renamed EmbroideryContext => LambadaResources
As part of the project, we are cleaning up residual names that still exist that were part of the initial proof of concept.
Simply replace `EmbroideryContext` with `LambadaResources`

### Smaller bundles: Moved '@attire/core/dist/lib/api/utils' to '@lambada/utils'
Some of the utility functions were shipped on the core library and that caused pulumi to bundle it as part of the deployment.  Now there are moved to it's own package called `@lambada/utils`, which is very light and has no runtime dependencies besides the `aws-sdk`.
