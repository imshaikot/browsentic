// Site-wide constants and the information architecture. Every absolute URL on the
// site is built from `origin`, so moving hosts is one environment variable.
import { REPO, VERSION, SEO } from './copy.js'

const origin = (process.env.SITE_ORIGIN ?? 'https://browsentic.com').replace(/\/$/, '')

export default {
  origin,
  url: (path = '/') => new URL(path, origin + '/').href,
  repo: REPO,
  version: VERSION,
  name: 'Browsentic',
  author: SEO.author,
  authorUrl: 'https://github.com/imshaikot',
  license: 'MIT',
  themeColor: '#1a1512',
  // The former GitHub Pages home. Kept so the retirement stub and the docs can
  // both name it without hardcoding the string twice.
  legacyOrigin: 'https://imshaikot.github.io/browsentic/',
  buildDate: new Date().toISOString().slice(0, 10),
  year: new Date().getFullYear(),

  // Primary navigation. `key` matches each page's `pageKey` so the current item
  // can be marked aria-current without any client-side routing.
  nav: [
    { key: 'how-it-works', href: '/how-it-works/', label: 'How it works' },
    { key: 'capabilities', href: '/capabilities/', label: 'Capabilities' },
    { key: 'skills', href: '/skills/', label: 'Skills' },
    { key: 'automations', href: '/automations/', label: 'Automations' },
    { key: 'security', href: '/security/', label: 'Security' },
    { key: 'docs', href: '/docs/', label: 'Docs' },
  ],

  footer: [
    {
      title: 'Product',
      links: [
        { href: '/how-it-works/', label: 'How it works' },
        { href: '/capabilities/', label: 'Capabilities' },
        { href: '/orchestration/', label: 'Agent orchestration' },
        { href: '/automations/', label: 'Automations' },
        { href: '/live-tools/', label: 'Live tools' },
        { href: '/webmcp/', label: 'WebMCP' },
        { href: '/skills/', label: 'Skills and recordings' },
        { href: '/vs-claude-in-chrome/', label: 'vs Claude in Chrome' },
      ],
    },
    {
      title: 'Get started',
      links: [
        { href: '/install/', label: 'Install' },
        { href: '/mcp-server/', label: 'MCP server setup' },
        { href: '/docs/guide/pair/', label: 'Pair your browser' },
        { href: '/docs/guide/first-run/', label: 'First run' },
        { href: '/faq/', label: 'FAQ' },
      ],
    },
    {
      title: 'Documentation',
      links: [
        { href: '/docs/', label: 'All docs' },
        { href: '/docs/guide/', label: 'User guide' },
        { href: '/docs/reference/tools/', label: 'Tool reference' },
        { href: '/docs/reference/errors/', label: 'Error codes' },
        { href: '/docs/internals/', label: 'Internals' },
      ],
    },
    {
      title: 'Project',
      links: [
        { href: REPO, label: 'Source on GitHub', external: true },
        { href: `${REPO}/releases`, label: 'Releases', external: true },
        { href: `${REPO}/issues`, label: 'Issues', external: true },
        { href: '/security/', label: 'Security model' },
        { href: '/llms.txt', label: 'llms.txt' },
      ],
    },
  ],
}
