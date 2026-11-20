// @ts-check
const { themes } = require('prism-react-renderer')

/** @type {import('@docusaurus/types').Config} */
module.exports = {
  title: 'Lambada',
  tagline: 'Serverless AWS stacks in TypeScript, declared by name',
  url: 'https://lambada-project.github.io',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'lambada-project',
  projectName: 'lambada-project.github.io',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    // .md pages are CommonMark, so braces and angle brackets in prose are text; .mdx pages are MDX.
    format: 'detect',
    hooks: { onBrokenMarkdownLinks: 'throw' },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/lambada-project/lambada/edit/main/docs/',
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      /** @type {import('@easyops-cn/docusaurus-search-local').PluginOptions} */
      ({
        hashed: true,
        docsRouteBasePath: '/',
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      docs: {
        sidebar: { hideable: true },
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 3,
      },
      navbar: {
        title: 'Lambada',
        hideOnScroll: false,
        logo: {
          alt: 'Lambada',
          src: 'img/logo-light.png',
          srcDark: 'img/logo-dark.png',
        },
        items: [
          // Plain links: a `doc` item is marked active on every page of its sidebar, and there is one sidebar.
          { to: '/quickstart', label: 'Quickstart', position: 'left', activeBaseRegex: '^/quickstart$' },
          { to: '/concepts', label: 'Concepts', position: 'left', activeBaseRegex: '^/concepts$' },
          { to: '/reference/run', label: 'Reference', position: 'left', activeBaseRegex: '^/reference/' },
          {
            href: 'https://www.npmjs.com/package/@lambada/core',
            label: 'npm',
            position: 'right',
          },
          {
            href: 'https://github.com/lambada-project/lambada',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Learn',
            items: [
              { label: 'Introduction', to: '/' },
              { label: 'Quickstart', to: '/quickstart' },
              { label: 'Core concepts', to: '/concepts' },
            ],
          },
          {
            title: 'Reference',
            items: [
              { label: 'run()', to: '/reference/run' },
              { label: '@lambada/utils', to: '/reference/utils' },
              { label: 'Migration guide', to: '/migration' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'GitHub', href: 'https://github.com/lambada-project/lambada' },
              { label: 'Issues', href: 'https://github.com/lambada-project/lambada/issues' },
              { label: 'X / Twitter', href: 'https://twitter.com/andreujuanc' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Lambada Project. Built with Docusaurus.`,
      },
      prism: {
        theme: themes.github,
        darkTheme: themes.dracula,
        additionalLanguages: ['bash', 'json', 'docker', 'ini'],
      },
    }),
}
