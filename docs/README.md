# Lambada documentation

The site at [lambada-project.github.io](https://lambada-project.github.io), built with [Docusaurus 3](https://docusaurus.io).

```bash
npm ci        # install
npm start     # dev server with live reload, http://localhost:3000
npm run build # static site in build/, fails on broken links and anchors
npm run serve # serve build/ locally
```

## Writing pages

- Pages live in `docs/`. Each has a `slug`, a `sidebar_label` and a one-line `description` in its front matter, and is listed in `sidebars.js`.
- `.md` pages are CommonMark. Use `.mdx` only for a page that needs components, such as `home.mdx`.
- Link to other pages by slug (`[Queues](queues)`) or by file (`[Queues](queues.md)`). The build fails on a broken link or anchor.
- Show the current API: plain declarations with the `resources` grant map, under `api.endpointDefinitions`.
- Create AWS SDK clients inside handlers, on first use: a client created at module level can't be serialized by Pulumi.
- Prefer one complete example over several fragments, and state defaults and limits in tables.
