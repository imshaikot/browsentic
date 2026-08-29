#!/usr/bin/env node
// Copies docs/ out of the `main` worktree into src/docs/, rewriting every relative
// link for the web tree and injecting the front matter Eleventy needs.
//
// The synced copy IS committed, so a build never depends on `main` being checked
// out next door. Re-run this whenever docs change on `main`.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITE = path.resolve(HERE, '..')
const OUT = path.join(SITE, 'src/docs')
const REPO_BLOB = 'https://github.com/imshaikot/browsentic/blob/main'
const REPO_TREE = 'https://github.com/imshaikot/browsentic/tree/main'

const SOURCES = [
  process.env.DOCS_SRC,
  path.resolve(SITE, '../browsentic/docs'),
  path.resolve(SITE, '../docs'),
].filter(Boolean)

const src = SOURCES.find((p) => existsSync(path.join(p, 'README.md')))
if (!src) {
  console.error(`sync-docs: no docs/ found. Looked in:\n  ${SOURCES.join('\n  ')}`)
  process.exit(1)
}

/** Section metadata: order in the sidebar, and the label above each group. */
const SECTIONS = {
  '': { label: 'Overview', order: 0 },
  guide: { label: 'User guide', order: 1 },
  'guide/features': { label: 'Features', order: 2 },
  reference: { label: 'Reference', order: 3 },
  internals: { label: 'Internals', order: 4 },
}

/** Explicit reading order within a section; anything unlisted sorts alphabetically after. */
const ORDER = {
  guide: ['install', 'pair', 'first-run', 'agents', 'mcp-clients', 'configuration', 'approvals', 'limits', 'troubleshooting', 'maintenance'],
  'guide/features': ['conversations', 'instant-commands', 'page-actions', 'screenshots', 'theming', 'captcha', 'monitoring', 'scheduling', 'site-maps', 'recordings', 'diagnostics', 'files', 'a-eye', 'skills'],
  reference: ['tools', 'cli', 'errors'],
  internals: ['overview', 'transport', 'registry', 'request-path', 'extension', 'agent-runs', 'guardrails', 'subsystems', 'state', 'contributing'],
}

async function walk(dir, base = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue
      out.push(...(await walk(path.join(dir, entry.name), rel)))
    } else if (entry.name.endsWith('.md')) {
      out.push(rel)
    }
  }
  return out
}

/** docs-relative markdown path -> site URL. `README.md` collapses to its directory. */
function urlFor(relPath) {
  const stripped = relPath.replace(/\.md$/, '')
  const asDir = stripped.replace(/(^|\/)README$/, '')
  return asDir ? `/docs/${asDir}/` : '/docs/'
}

/**
 * Resolve one markdown link target against the file that contains it.
 * Anything that escapes docs/ becomes a GitHub link, because it is source, not a page.
 */
function rewriteTarget(target, fromRel) {
  if (/^(https?:|mailto:|#)/.test(target)) return target

  const [rawPath, hash = ''] = target.split('#')
  const suffix = hash ? `#${hash.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')}` : ''
  if (!rawPath) return target

  const fromDir = path.dirname(fromRel)
  const resolved = path.posix.normalize(path.posix.join(fromDir === '.' ? '' : fromDir, rawPath))

  if (resolved.startsWith('..')) {
    // Out of docs/: one level up is the repo root.
    const repoPath = resolved.replace(/^(\.\.\/)+/, '')
    if (!repoPath || repoPath === 'README.md') return `${REPO_BLOB}/README.md`
    return `${rawPath.endsWith('/') ? REPO_TREE : REPO_BLOB}/${repoPath}`
  }
  if (resolved.startsWith('assets/')) return `/docs/${resolved}`
  if (rawPath.endsWith('/')) return `/docs/${resolved.replace(/\/$/, '')}/${suffix}`
  if (resolved.endsWith('.md')) return `${urlFor(resolved)}${suffix}`
  return `/docs/${resolved}${suffix}`
}

const yaml = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * Lifts the opening paragraph out of the body. It becomes the deck under the H1,
 * and the body no longer repeats it. Pages that go straight into a heading have
 * no deck, and their body is returned untouched.
 */
function splitDeck(body) {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++

  const first = lines[i]?.trim() ?? ''
  const isProse = first && !/^(#|```|!\[|>|\||[-*+]\s|\d+\.\s|-{3,}$|\*{3,}$|_{3,}$|<)/.test(first)
  if (!isProse) return { deck: '', rest: body }

  const collected = []
  while (i < lines.length && lines[i].trim() && !/^#/.test(lines[i].trim())) {
    collected.push(lines[i].trim())
    i++
  }

  const deck = collected
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { deck, rest: lines.slice(i).join('\n').trimStart() }
}

/**
 * A meta description, built from the opening prose. Accumulates paragraphs until
 * there is enough to be useful, then trims to a word boundary under the length
 * Google will actually show. Fenced code, images, tables and rules are not prose.
 */
function ledeFrom(body, title) {
  const prose = body
    .replace(/^```[\s\S]*?^```$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const chunks = []
  // Some pages go straight from the H1 into a heading, with no intro at all.
  // Their first prose reads as a continuation, so lead with the subject instead.
  let sawHeading = false
  let leadWithTitle = false
  for (const line of prose.split('\n')) {
    const t = line.trim()
    if (!t) {
      if (chunks.join(' ').length >= 120) break
      continue
    }
    if (/^#/.test(t)) { sawHeading = true; continue }
    if (/^(>|\||-{3,}$|\*{3,}$|_{3,}$)/.test(t)) continue
    if (/^([-*+]\s|\d+\.\s)/.test(t)) continue
    if (!chunks.length && sawHeading) leadWithTitle = true
    chunks.push(t)
    if (chunks.join(' ').length >= 220) break
  }
  if (leadWithTitle && title) chunks.unshift(`${title}.`)

  const flat = chunks
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (flat.length <= 158) return flat
  const cut = flat.slice(0, 158)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\s]+$/, '')}…`
}

// Remove only what this script generates. src/docs/docs.11tydata.js is hand-written
// infrastructure that lives in the same directory and must survive a re-sync.
if (existsSync(OUT)) {
  for (const entry of await readdir(OUT, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.name.endsWith('.md')) {
      await rm(path.join(OUT, entry.name), { recursive: true, force: true })
    }
  }
}
await mkdir(OUT, { recursive: true })

const files = (await walk(src)).sort()
let written = 0

for (const rel of files) {
  const raw = await readFile(path.join(src, rel), 'utf8')

  const title = (raw.match(/^#\s+(.+)$/m) || [, path.basename(rel, '.md')])[1].trim()
  const full = raw.replace(/^#\s+.+$/m, '').trimStart()
  const lede = ledeFrom(full, title)
  const { deck, rest: body } = splitDeck(full)

  // Rewrite links and images, skipping fenced code so examples stay literal.
  const parts = body.split(/(^```[\s\S]*?^```$)/gm)
  const rewritten = parts
    .map((chunk, i) =>
      i % 2
        ? chunk
        : chunk.replace(/(!?\[[^\]]*\])\(([^)\s]+)(\s+"[^"]*")?\)/g, (_m, label, target, titleAttr) =>
            `${label}(${rewriteTarget(target, rel)}${titleAttr || ''})`,
          ),
    )
    .join('')

  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  const slug = path.basename(rel, '.md')
  const isIndex = slug === 'README'
  const sectionKey = isIndex ? dir : dir
  const section = SECTIONS[sectionKey] ?? { label: dir || 'Docs', order: 9 }
  const listed = ORDER[dir] ?? []
  const idx = listed.indexOf(slug)

  const seoTitle =
    isIndex && sectionKey === ''
      ? 'Browsentic documentation: install, pair and automate any browser tab'
      : `${title} — Browsentic ${section.label.toLowerCase()}`

  const fm = [
    '---',
    'layout: layouts/doc.njk',
    'pageKey: docs',
    `title: ${yaml(title)}`,
    `seoTitle: ${yaml(seoTitle)}`,
    `description: ${yaml(lede)}`,
    `deck: ${yaml(deck)}`,
    `docsPath: ${yaml(rel)}`,
    `section: ${yaml(sectionKey)}`,
    `sectionLabel: ${yaml(section.label)}`,
    `sectionOrder: ${section.order}`,
    `order: ${isIndex ? -1 : idx === -1 ? 99 : idx}`,
    `isIndex: ${isIndex}`,
    `permalink: ${yaml(urlFor(rel))}`,
    `sourceUrl: ${yaml(`${REPO_BLOB}/docs/${rel}`)}`,
    '---',
    '',
  ].join('\n')

  const dest = path.join(OUT, rel)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, fm + rewritten)
  written++
}

// Diagrams and screenshots referenced by the pages above.
const assetsSrc = path.join(src, 'assets')
if (existsSync(assetsSrc)) {
  await cp(assetsSrc, path.join(OUT, 'assets'), { recursive: true })
  const n = (await readdir(assetsSrc)).length
  console.log(`sync-docs: ${written} pages, ${n} assets  <-  ${path.relative(SITE, src)}`)
} else {
  console.log(`sync-docs: ${written} pages  <-  ${path.relative(SITE, src)}`)
}
