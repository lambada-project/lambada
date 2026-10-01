---
id: migration-guide
title: Migration Guide
sidebar_label: Migration Guide
slug: /migration
---


## Index keys move to `keySchemas` (1.31)
`@lambada/core` 1.31 hands every table index to the AWS provider with `keySchemas`, which replaces the deprecated `hashKey` and `rangeKey`. A table deployed with an earlier provider may record the index in its state with `hashKey` and `rangeKey` only. The provider then reads the index as a different one, and **deletes and recreates it**: queries on it fail until DynamoDB has backfilled it again.

Before a stack's first deploy with 1.31 or later, refresh it once **with the program**:

```bash
pulumi refresh --run-program --stack <stack>
pulumi stack export --stack <stack> | npx lambada-check-index-key-schemas
pulumi preview --diff --stack <stack>   # the tables show no change to globalSecondaryIndexes
```

Running the program loads the provider version the program depends on, and that provider records each index's `keySchemas` next to its `hashKey` and `rangeKey`. A plain `pulumi refresh` runs the provider version the state was written with, which may record nothing new. After the refresh:
- 1.31 deploys the indexes unchanged;
- a deploy with an earlier version, which states `hashKey` and `rangeKey`, also deploys them unchanged.

`lambada-check-index-key-schemas` reads the export and exits non-zero, naming each table and index, while any index still records `hashKey` without `keySchemas`. Run it in CI before `pulumi up` to catch a stack that missed the refresh.

A refresh also takes into the state any change made to the stack's resources outside Pulumi, as every refresh does. Read its summary.

**Check the preview before deploying.** A table index showing `- hashKey` or `- rangeKey` will be recreated. The exception is a deploy that also adds or removes indexes: its preview redraws the untouched indexes with the same lines.

## From Attire to Lambada (March 2021)
### Core library is now `@lambada/core`
We keel the breaking changes to a minimum and this migration should not cause major issues. Just rename @attire to @lambada and follow the steps below:

### Renamed EmbroideryContext => LambadaResources
As part of the project, we are cleaning up residual names that still exist that were part of the initial proof of concept.
Simply replace `EmbroideryContext` with `LambadaResources`

### Smaller bundles: Moved '@attire/core/dist/lib/api/utils' to '@lambada/utils'
Some of the utility functions were shipped on the core library and that caused pulumi to bundle it as part of the deployment.  Now there are moved to it's own package called `@lambada/utils`, which is very light and has no runtime dependencies besides the `aws-sdk`.
