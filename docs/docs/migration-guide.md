---
id: migration-guide
title: Migration Guide
sidebar_label: Migration Guide
slug: /migration
---


## From Attire to Lambada (March 2021)
### Core library is now `@lambada/core`
We keel the breaking changes to a minimum and this migration should not cause major issues. Just rename @attire to @lambada and follow the steps below:

### Renamed EmbroideryContext => LambadaResources
As part of the project, we are cleaning up residual names that still exist that were part of the initial proof of concept.
Simply replace `EmbroideryContext` with `LambadaResources`

### Smaller bundles: Moved '@attire/core/dist/lib/api/utils' to '@lambada/utils'
Some of the utility functions were shipped on the core library and that caused pulumi to bundle it as part of the deployment.  Now there are moved to it's own package called `@lambada/utils`, which is very light and has no runtime dependencies besides the `aws-sdk`.
