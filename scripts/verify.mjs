#!/usr/bin/env node
// Gates the build. Every check here has failed silently in a browser at least
// once, which is why it is asserted rather than eyeballed.
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_site')
const errors = []
const warnings = []

const fail = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

if (!existsSync(OUT)) {
  console.error('verify: _site does not exist — run the build first')
  process.exit(1)
}

const files = await walk(OUT)
const html = files.filter((f) => f.endsWith('.html'))
const rel = (f) => path.relative(OUT, f)

// ---- Required artefacts ----------------------------------------------------

for (const required of ['llms.txt', 'llms-full.txt', 'sitemap.xml', 'robots.txt', 'og.png', 'assets/css/main.css', 'assets/js/site.js', '404.html']) {
  const full = path.join(OUT, required)
  if (!existsSync(full)) fail(`missing: ${required}`)
  else if ((await stat(full)).size === 0) fail(`empty: ${required}`)
}

const css = existsSync(path.join(OUT, 'assets/css/main.css'))
  ? await readFile(path.join(OUT, 'assets/css/main.css'), 'utf8')
  : ''
if (css.length < 10_000) fail(`assets/css/main.css looks unbuilt (${css.length} bytes)`)

// ---- Per-page SEO ----------------------------------------------------------

const pageUrls = new Set()

for (const file of html) {
  const body = await readFile(file, 'utf8')
  const name = rel(file)

  const url = '/' + name.replace(/index\.html$/, '').replace(/\\/g, '/')
  pageUrls.add(url)

  const title = body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
  if (!title) fail(`${name}: no <title>`)
  else if (title.length > 70) warn(`${name}: title is ${title.length} chars — "${title}"`)

  const desc = body.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim()
  if (!desc) fail(`${name}: no meta description`)
  else if (desc.length < 70 || desc.length > 165) warn(`${name}: description is ${desc.length} chars`)

  if (!/rel="canonical"/.test(body)) fail(`${name}: no canonical link`)
  if (!/application\/ld\+json/.test(body)) fail(`${name}: no JSON-LD`)

  const h1s = body.match(/<h1[\s>]/g) ?? []
  if (h1s.length !== 1) fail(`${name}: ${h1s.length} <h1> elements, expected exactly 1`)

  if (!/property="og:image"/.test(body)) fail(`${name}: no og:image`)

  // JSON-LD must parse — a broken graph is worse than none.
  for (const [, json] of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(json)
    } catch (e) {
      fail(`${name}: JSON-LD does not parse — ${e.message}`)
    }
  }

  // Untranslated template syntax that made it into the output.
  // {{email}} appears legitimately in the recordings copy, so only flag the
  // spaced form Nunjucks actually emits when a tag fails to render.
  if (/\{\{\s|\{%[-\s]/.test(body)) fail(`${name}: unrendered template syntax in output`)
  if (/>undefined<|"undefined"/.test(body)) fail(`${name}: "undefined" leaked into the output`)

  // Images need alt text.
  for (const [tag] of body.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(tag)) fail(`${name}: <img> without alt — ${tag.slice(0, 90)}`)
  }
}

// ---- Internal links resolve ------------------------------------------------

const assetPaths = new Set(files.map((f) => '/' + rel(f).replace(/\\/g, '/')))

for (const file of html) {
  const body = await readFile(file, 'utf8')
  const name = rel(file)

  for (const [, href] of body.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    if (pageUrls.has(href) || assetPaths.has(href)) continue
    if (assetPaths.has(href.replace(/\/$/, '/index.html'))) continue
    if (href.endsWith('/') && pageUrls.has(href)) continue
    fail(`${name}: dead internal link -> ${href}`)
  }
}

// ---- Sitemap ---------------------------------------------------------------

if (existsSync(path.join(OUT, 'sitemap.xml'))) {
  const sitemap = await readFile(path.join(OUT, 'sitemap.xml'), 'utf8')
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (locs.length < 20) fail(`sitemap has only ${locs.length} URLs`)

  for (const loc of locs) {
    const p = new URL(loc).pathname
    if (!pageUrls.has(p)) fail(`sitemap lists a URL with no page: ${p}`)
  }

  const indexable = [...pageUrls].filter((u) => {
    const f = path.join(OUT, u.replace(/\/$/, '/index.html').replace(/^\//, ''))
    return existsSync(f)
  })
  const missing = indexable.filter((u) => !locs.some((l) => new URL(l).pathname === u) && u !== '/404.html')
  if (missing.length) warn(`not in sitemap: ${missing.join(', ')}`)
}

// ---- Report ----------------------------------------------------------------

const pages = html.length
for (const w of warnings) console.warn(`  warn  ${w}`)
for (const e of errors) console.error(`  FAIL  ${e}`)

if (errors.length) {
  console.error(`\nverify: ${errors.length} failure(s) across ${pages} pages`)
  process.exit(1)
}

console.log(`verify: ${pages} pages OK${warnings.length ? `, ${warnings.length} warning(s)` : ''}`)
