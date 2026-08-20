// Everything a machine reads is built here, from the same exports the page renders.
// Head tags, JSON-LD, the no-JS body mirror, llms.txt, sitemap.xml and robots.txt
// all derive from content.ts, so none of them can drift from the visible copy.
import {
  CTA,
  FAQ,
  HERO,
  LIMITS,
  MCP_POINTS,
  MODES,
  PIPELINE,
  QUICKSTART,
  REPO,
  RESOURCES,
  SECTIONS,
  SECURITY,
  SEO,
  STATS,
  TOOL_GROUPS,
  VERSION,
} from './content'

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const lines = (t: string | readonly string[]) => (typeof t === 'string' ? t : t.join(' '))

const heroTitle = `${HERO.title.lead} ${HERO.title.tail}${HERO.title.accent}`

/**
 * Google Search Console ownership token for the URL-prefix property
 * https://imshaikot.github.io/browsentic/. Paste the content value from
 * GSC's "HTML tag" verification method; empty renders no tag.
 */
const GOOGLE_SITE_VERIFICATION = 'Gmr19xvpOAMf0o5vcWy5pw_E0jikNDjuRXHCPm1K4Bw'

export function headTags(siteUrl: string) {
  const image = `${siteUrl}og.png`

  return [
    ...(GOOGLE_SITE_VERIFICATION
      ? [`<meta name="google-site-verification" content="${esc(GOOGLE_SITE_VERIFICATION)}" />`]
      : []),
    `<title>${esc(SEO.title)}</title>`,
    `<meta name="description" content="${esc(SEO.description)}" />`,
    `<link rel="canonical" href="${siteUrl}" />`,
    // Absolute: Vite only rewrites the base prefix onto asset extensions it recognises.
    `<link rel="alternate" type="text/plain" href="${siteUrl}llms.txt" title="llms.txt" />`,
    `<meta name="author" content="${esc(SEO.author)}" />`,
    // max-image-preview:large is what gets the social card used as the search thumbnail.
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />`,

    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Browsentic" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${esc(SEO.social.title)}" />`,
    `<meta property="og:description" content="${esc(SEO.social.description)}" />`,
    `<meta property="og:url" content="${siteUrl}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(SEO.imageAlt)}" />`,

    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(SEO.social.title)}" />`,
    `<meta name="twitter:description" content="${esc(SEO.social.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${esc(SEO.imageAlt)}" />`,
  ].join('\n    ')
}

export function jsonLd(siteUrl: string) {
  const author = { '@type': 'Person', name: SEO.author, url: 'https://github.com/imshaikot' }

  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}#software`,
      name: 'Browsentic',
      description: SEO.summary,
      applicationCategory: 'DeveloperApplication',
      applicationSubCategory: 'Browser automation',
      operatingSystem: 'macOS, Linux, Windows',
      softwareVersion: VERSION.replace(/^v/, ''),
      softwareRequirements: 'Node.js 20 or newer, Chrome or Firefox, one agent CLI on PATH (Claude Code, Codex or Antigravity)',
      url: siteUrl,
      codeRepository: REPO,
      downloadUrl: `${REPO}/releases`,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      keywords: SEO.keywords.join(', '),
      screenshot: `${siteUrl}og.png`,
      featureList: TOOL_GROUPS.map((g) => `${g.label}: ${g.tools.join(', ')}`),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author,
      maintainer: author,
    },
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}#website`,
      url: siteUrl,
      name: 'Browsentic',
      description: SEO.description,
      inLanguage: 'en',
      about: { '@id': `${siteUrl}#software` },
      publisher: author,
    },
    {
      // Google restricts FAQ rich results to authoritative sites, but the markup is
      // still what Bing and every answer engine reads to lift a straight answer.
      '@type': 'FAQPage',
      '@id': `${siteUrl}#faq`,
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ]

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
}

/**
 * The page is client rendered, so raw-HTML crawlers (most AI crawlers among them)
 * would otherwise read an empty root div. This mirrors the copy into the markup.
 */
export function noscriptBody(siteUrl: string) {
  const section = (title: string, body: string) =>
    `<section><h2>${esc(title)}</h2>${body}</section>`

  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`

  return [
    `<h1>${esc(heroTitle)}</h1>`,
    `<p>${esc(HERO.lede)}</p>`,
    list([
      `<a href="${REPO}">Source on GitHub</a>`,
      `<a href="${REPO}/blob/main/docs/installation.md">Installation</a>`,
      `<a href="${REPO}/blob/main/docs/features.md">Features</a>`,
      `<a href="${REPO}/blob/main/docs/architecture.md">Architecture</a>`,
      `<a href="${REPO}/blob/main/docs/tools.md">Tools</a>`,
      `<a href="${siteUrl}llms.txt">llms.txt</a>`,
    ]),
    list(STATS.map((s) => `<strong>${s.value}${s.suffix}</strong> ${esc(s.label)} (${esc(s.note)})`)),

    section(
      lines(SECTIONS.how.title),
      `<p>${esc(SECTIONS.how.lede)}</p>` +
        PIPELINE.map(
          (n) => `<h3>${esc(n.title)}</h3><p><em>${esc(n.sub)}</em> ${esc(n.body)}</p>`,
        ).join(''),
    ),

    section(
      lines(SECTIONS.capabilities.title),
      `<p>${esc(SECTIONS.capabilities.lede)}</p>` +
        TOOL_GROUPS.map(
          (g) =>
            `<h3>${esc(g.label)}</h3><p>${esc(g.blurb)}</p>` +
            list(g.tools.map((t) => `<code>${esc(t)}</code>`)),
        ).join('') +
        `<h3>Read-only resources</h3>` +
        list(RESOURCES.map((r) => `<code>${esc(r.uri)}</code> ${esc(r.desc)}`)),
    ),

    section(
      lines(SECTIONS.teach.title),
      `<p>${esc(SECTIONS.teach.lede)}</p>` +
        MODES.map(
          (m) =>
            `<h3>${esc(m.tab)}: ${esc(m.title)}</h3><p>${esc(m.body)}</p>` +
            list(m.points.map(([t, b]) => `<strong>${esc(t)}</strong> ${esc(b)}`)),
        ).join(''),
    ),

    section(
      lines(SECTIONS.mcp.title),
      `<p>${esc(SECTIONS.mcp.lede)}</p>` +
        MCP_POINTS.map((p) => `<h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>`).join(''),
    ),

    section(
      lines(SECTIONS.security.title),
      `<p>${esc(SECTIONS.security.lede)}</p>` +
        list(SECURITY.map((s) => `<strong>${esc(s.title)}</strong> ${esc(s.body)}`)) +
        `<h3>Two limits worth stating</h3>` +
        list(LIMITS.map((l) => `<strong>${esc(l.title)}</strong> ${esc(l.body)}`)),
    ),

    section(
      lines(SECTIONS.start.title),
      `<p>${esc(SECTIONS.start.lede)}</p>` +
        QUICKSTART.map(
          (s) =>
            `<h3>${s.n}. ${esc(s.title)}</h3><p>${esc(s.body)}</p><pre><code>${esc(s.code)}</code></pre>`,
        ).join(''),
    ),

    section(
      lines(SECTIONS.faq.title),
      FAQ.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join(''),
    ),

    `<p>${esc(CTA.lede)} <a href="${REPO}">${esc(REPO)}</a></p>`,
  ].join('\n      ')
}

/** https://llmstxt.org: a short, linkable map of the project for language models. */
export function llmsTxt(siteUrl: string) {
  const link = (label: string, href: string, note: string) => `- [${label}](${href}): ${note}`

  return `# Browsentic

> ${SEO.summary}

Browsentic is ${VERSION}, MIT licensed, and runs entirely on your own machine: a Manifest V3
extension, a local daemon on loopback, and the AI agent you already have installed. There is no
hosted relay, no API key, and no headless browser. It drives the real tab you are signed into.

${TOOL_GROUPS.map((g) => `- **${g.label}** (${g.tools.length} tools): ${g.blurb}`).join('\n')}

## Docs

${link('Installation', `${REPO}/blob/main/docs/installation.md`, 'prerequisites, setup, configuration, limitations, and driving it from a non-Claude agent')}
${link('Features', `${REPO}/blob/main/docs/features.md`, 'every capability and when to reach for it')}
${link('Architecture', `${REPO}/blob/main/docs/architecture.md`, 'how an instruction becomes a click, end to end')}
${link('Tools', `${REPO}/blob/main/docs/tools.md`, 'every tool published to an MCP client, and the action behind it')}
${link('README', REPO, 'project overview')}

## Optional

${link('Full site text', `${siteUrl}llms-full.txt`, 'the entire landing page as markdown')}
${link('Releases', `${REPO}/releases`, 'built extension archives per version')}

## Key facts

- Install as an MCP server: \`claude mcp add browsentic -- browsentic-mcp\`
- ${STATS.map((s) => `${s.value}${s.suffix} ${s.label}`).join('\n- ')}
- The side panel runs on Claude Code, Codex or Antigravity, switched with one click. As an MCP server it is agent-agnostic: Cursor, Zed, Claude Desktop or any MCP client drives the same browser.
- Pairing is two-gated: the daemon classifies the WebSocket peer by handshake Origin, then requires a pairing token or an origin-bound session key. A web page cannot reach the control path.
`
}

/** The whole page as markdown, for models that want the text rather than the map. */
export function llmsFullTxt(siteUrl: string) {
  const block = (title: string | readonly string[], lede: string | undefined, body: string) =>
    `## ${lines(title)}\n\n${lede ? `${lede}\n\n` : ''}${body}`

  return `# Browsentic

${heroTitle}

${HERO.lede}

Source: ${REPO}
Site: ${siteUrl}
Version: ${VERSION} (MIT)

${STATS.map((s) => `- ${s.value}${s.suffix} ${s.label}: ${s.note}`).join('\n')}

${block(
  SECTIONS.how.title,
  SECTIONS.how.lede,
  PIPELINE.map((n) => `### ${n.title}\n\n_${n.sub}_\n\n${n.body}`).join('\n\n'),
)}

${block(
  SECTIONS.capabilities.title,
  SECTIONS.capabilities.lede,
  TOOL_GROUPS.map((g) => `### ${g.label}\n\n${g.blurb}\n\n${g.tools.map((t) => `- \`${t}\``).join('\n')}`).join('\n\n') +
    `\n\n### Read-only resources\n\n${RESOURCES.map((r) => `- \`${r.uri}\`: ${r.desc}`).join('\n')}`,
)}

${block(
  SECTIONS.teach.title,
  SECTIONS.teach.lede,
  MODES.map(
    (m) =>
      `### ${m.tab}: ${m.title}\n\n${m.body}\n\nInvoke with: \`${m.invocation}\`\n\n${m.points
        .map(([t, b]) => `- **${t}** ${b}`)
        .join('\n')}`,
  ).join('\n\n'),
)}

${block(
  SECTIONS.mcp.title,
  SECTIONS.mcp.lede,
  MCP_POINTS.map((p) => `### ${p.title}\n\n${p.body}`).join('\n\n'),
)}

${block(
  SECTIONS.security.title,
  SECTIONS.security.lede,
  SECURITY.map((s) => `### ${s.title}\n\n${s.body}`).join('\n\n') +
    `\n\n### Two limits worth stating\n\n${LIMITS.map((l) => `- **${l.title}** ${l.body}`).join('\n')}`,
)}

${block(
  SECTIONS.start.title,
  SECTIONS.start.lede,
  QUICKSTART.map((s) => `### ${s.n}. ${s.title}\n\n${s.body}\n\n\`\`\`${s.lang}\n${s.code}\n\`\`\``).join('\n\n'),
)}

${block(SECTIONS.faq.title, undefined, FAQ.map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n'))}
`
}

export function sitemapXml(siteUrl: string, lastmod: string) {
  // One page, one URL. In-page anchors are not separate documents and do not belong here.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`
}

export function robotsTxt(siteUrl: string) {
  return `# Browsentic ${siteUrl}
# Crawlers only honour /robots.txt at the origin root, which a GitHub Pages project
# site does not own. This copy is advisory, for tools that fetch it beside the page.
# Everything is open to everyone, AI crawlers included.

User-agent: *
Allow: /

Sitemap: ${siteUrl}sitemap.xml
`
}
