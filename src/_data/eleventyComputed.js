// Per-page structured data. Every page carries a WebSite + SoftwareApplication
// pair so the entity is unambiguous wherever a crawler lands, plus a
// BreadcrumbList reflecting its real position in the tree.
import site from './site.js'
import { FAQ, REPO, SEO, TOOL_GROUPS, VERSION } from './copy.js'

const abs = (p) => new URL(p || '/', site.origin + '/').href

const author = { '@type': 'Person', name: SEO.author, url: site.authorUrl }

const softwareApplication = {
  '@type': 'SoftwareApplication',
  '@id': abs('/#software'),
  name: 'Browsentic',
  alternateName: 'Browsentic AI browser extension',
  description: SEO.summary,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Browser automation',
  operatingSystem: 'macOS, Linux, Windows',
  softwareVersion: VERSION.replace(/^v/, ''),
  softwareRequirements:
    'Node.js 20 or newer, Chrome or another Chromium browser, one agent CLI on PATH (Claude Code, Codex or Antigravity)',
  url: abs('/'),
  codeRepository: REPO,
  downloadUrl: `${REPO}/releases`,
  license: 'https://opensource.org/licenses/MIT',
  isAccessibleForFree: true,
  keywords: SEO.keywords.join(', '),
  screenshot: abs('/og.png'),
  featureList: TOOL_GROUPS.map((g) => `${g.label}: ${g.tools.join(', ')}`),
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author,
  maintainer: author,
}

const website = {
  '@type': 'WebSite',
  '@id': abs('/#website'),
  url: abs('/'),
  name: 'Browsentic',
  description: SEO.description,
  inLanguage: 'en',
  about: { '@id': abs('/#software') },
  publisher: author,
}

/** Title for each path segment, so breadcrumbs read as words rather than slugs. */
const CRUMB_LABELS = {
  docs: 'Documentation',
  guide: 'User guide',
  features: 'Features',
  internals: 'Internals',
  reference: 'Reference',
  'how-it-works': 'How it works',
  'mcp-server': 'MCP server',
}

function breadcrumbs(url, title) {
  const parts = (url || '/').split('/').filter(Boolean)
  const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: abs('/') }]
  let acc = ''
  parts.forEach((part, i) => {
    acc += `/${part}`
    const last = i === parts.length - 1
    items.push({
      '@type': 'ListItem',
      position: i + 2,
      name: last ? title : (CRUMB_LABELS[part] ?? part.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())),
      item: abs(`${acc}/`),
    })
  })
  return { '@type': 'BreadcrumbList', '@id': abs(`${url}#breadcrumbs`), itemListElement: items }
}

export default {
  structuredData: (data) => {
    const url = data.page?.url ?? '/'
    const graph = [website, softwareApplication]

    if (url !== '/') graph.push(breadcrumbs(url, data.title))

    if (data.layout === 'layouts/doc.njk') {
      graph.push({
        '@type': 'TechArticle',
        '@id': abs(`${url}#article`),
        headline: data.title,
        description: data.description,
        url: abs(url),
        inLanguage: 'en',
        isPartOf: { '@id': abs('/#website') },
        about: { '@id': abs('/#software') },
        author,
        publisher: author,
        dateModified: site.buildDate,
        articleSection: data.sectionLabel,
        proficiencyLevel: data.section?.startsWith('internals') ? 'Expert' : 'Beginner',
      })
    }

    if (data.faqEntries?.length) {
      graph.push({
        '@type': 'FAQPage',
        '@id': abs(`${url}#faq`),
        mainEntity: data.faqEntries.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      })
    }

    if (data.howToSteps?.length) {
      graph.push({
        '@type': 'HowTo',
        '@id': abs(`${url}#howto`),
        name: data.title,
        description: data.description,
        totalTime: 'PT5M',
        step: data.howToSteps.map((s, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: s.title,
          text: s.body,
          url: abs(`${url}#step-${i + 1}`),
        })),
      })
    }

    return { '@context': 'https://schema.org', '@graph': graph }
  },

  faqEntries: (data) => (data.showFaq ? FAQ : data.faqEntries),
}
