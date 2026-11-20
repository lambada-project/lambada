// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    {
      type: 'category',
      label: 'Getting started',
      collapsed: false,
      items: ['home', 'quickstart', 'concepts', 'alternatives', 'aws-config'],
    },
    {
      type: 'category',
      label: 'HTTP',
      collapsed: false,
      items: ['http-api', 'authorizers', 'signed-apis', 'webhooks', 'static-sites'],
    },
    {
      type: 'category',
      label: 'Data and messaging',
      collapsed: false,
      items: ['tables', 'buckets', 'queues', 'topics', 'schedules'],
    },
    {
      type: 'category',
      label: 'Security',
      collapsed: false,
      items: ['permissions', 'keys-and-secrets', 'user-pools', 'custom-resources'],
    },
    {
      type: 'category',
      label: 'Functions',
      collapsed: false,
      items: ['functions', 'bundles', 'testing'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['reference/run', 'reference/utils', 'migration-guide'],
    },
  ],
};
