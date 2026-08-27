// Static HTML out. No client framework, no hydration, no runtime router.
import syntaxHighlight from '@11ty/eleventy-plugin-syntaxhighlight'
import anchor from 'markdown-it-anchor'
import attrs from 'markdown-it-attrs'

const slugify = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight, { preAttributes: { tabindex: 0 } })

  eleventyConfig.addPassthroughCopy({ public: '/' })
  eleventyConfig.addPassthroughCopy({ 'src/docs/assets': 'docs/assets' })
  eleventyConfig.addPassthroughCopy({ 'src/js': 'assets/js' })

  eleventyConfig.amendLibrary('md', (md) => {
    md.set({ html: true, linkify: false, typographer: false })
    md.use(attrs)
    md.use(anchor, {
      slugify,
      tabIndex: false,
      permalink: anchor.permalink.linkInsideHeader({
        symbol: '<span aria-hidden="true">#</span>',
        placement: 'after',
        class: 'heading-anchor',
        ariaHidden: false,
      }),
      permalinkAttrs: (slug) => ({ 'aria-label': `Permalink to “${slug}”` }),
      level: [2, 3, 4],
    })

    // Mermaid has no Prism grammar and we ship no client renderer. Keeping the
    // source as a labelled figure leaves the diagram crawlable as text.
    const fence = md.renderer.rules.fence
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      if (token.info.trim() === 'mermaid') {
        return `<figure class="diagram-source"><figcaption>Sequence diagram</figcaption><pre><code>${md.utils.escapeHtml(token.content)}</code></pre></figure>`
      }
      return fence(tokens, idx, options, env, self)
    }
  })

  // ---- Collections -------------------------------------------------------

  eleventyConfig.addCollection('docs', (api) =>
    api
      .getFilteredByGlob('src/docs/**/*.md')
      .sort((a, b) =>
        a.data.sectionOrder - b.data.sectionOrder || a.data.order - b.data.order ||
        a.data.title.localeCompare(b.data.title),
      ),
  )

  // Sidebar shape: ordered sections, each with its index page and its children.
  eleventyConfig.addCollection('docsNav', (api) => {
    const pages = api.getFilteredByGlob('src/docs/**/*.md')
    const bySection = new Map()
    for (const page of pages) {
      const key = page.data.section
      if (!bySection.has(key)) {
        bySection.set(key, { key, label: page.data.sectionLabel, order: page.data.sectionOrder, index: null, items: [] })
      }
      const group = bySection.get(key)
      if (page.data.isIndex) group.index = page
      else group.items.push(page)
    }
    for (const group of bySection.values()) {
      group.items.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title))
    }
    return [...bySection.values()].sort((a, b) => a.order - b.order)
  })

  // ---- Filters -----------------------------------------------------------

  eleventyConfig.addFilter('slug', slugify)

  eleventyConfig.addFilter('absolute', function (path) {
    const origin = this.ctx?.site?.origin ?? 'https://browsentic.com'
    return new URL(path || '/', origin + '/').href
  })

  eleventyConfig.addFilter('jsonld', (value) =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e'),
  )

  // On-page table of contents, read back out of the rendered markdown.
  eleventyConfig.addFilter('toc', (html) => {
    const out = []
    const re = /<h([23])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
    let m
    while ((m = re.exec(html || ''))) {
      const text = m[3]
        .replace(/<a class="heading-anchor"[\s\S]*?<\/a>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (text) out.push({ level: Number(m[1]), id: m[2], text })
    }
    return out
  })

  eleventyConfig.addFilter('readingTime', (html) => {
    const words = String(html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
    return Math.max(1, Math.round(words / 220))
  })

  eleventyConfig.addFilter('take', (arr, n) => (arr || []).slice(0, n))
  eleventyConfig.addFilter('flat', (arr) => (arr || []).flat())

  // ---- Transforms --------------------------------------------------------

  eleventyConfig.addTransform('html-polish', function (content) {
    if (!this.page.outputPath?.endsWith('.html')) return content
    return (
      content
        // Wide tables must scroll in their own box, never the page body.
        .replace(/<table>/g, '<div class="table-scroll"><table>')
        .replace(/<\/table>/g, '</table></div>')
        // Off-site links get the usual safety attributes.
        .replace(/<a href="(https?:\/\/[^"]+)"/g, (m, href) =>
          href.includes('browsentic.com') ? m : `<a href="${href}" target="_blank" rel="noopener"`,
        )
    )
  })

  return {
    dir: { input: 'src', output: '_site', includes: '_includes', data: '_data' },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    templateFormats: ['njk', 'md', '11ty.js'],
  }
}
