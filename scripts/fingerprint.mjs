#!/usr/bin/env node
// Content-hashes the CSS and JS, then rewrites every reference to them.
//
// /assets/* is served `immutable` for a year, which is only safe when the URL
// changes with the content. Without this, a style fix would never reach anyone
// who had already visited.
import { createHash } from 'node:crypto'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_site')

const TARGETS = ['assets/css/main.css', 'assets/js/site.js']

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const renames = new Map()

for (const target of TARGETS) {
  const full = path.join(OUT, target)
  if (!existsSync(full)) {
    console.error(`fingerprint: missing ${target}`)
    process.exit(1)
  }

  const hash = createHash('sha256').update(await readFile(full)).digest('hex').slice(0, 10)
  const ext = path.extname(target)
  const hashed = `${target.slice(0, -ext.length)}.${hash}${ext}`

  await rename(full, path.join(OUT, hashed))
  renames.set(`/${target}`, `/${hashed}`)
}

let rewritten = 0
for (const file of await walk(OUT)) {
  if (!/\.(html|txt|xml)$/.test(file)) continue
  const before = await readFile(file, 'utf8')
  let after = before
  for (const [from, to] of renames) after = after.split(from).join(to)
  if (after !== before) {
    await writeFile(file, after)
    rewritten++
  }
}

console.log(
  `fingerprint: ${renames.size} assets hashed, ${rewritten} files rewritten (${[...renames.values()]
    .map((v) => path.basename(v))
    .join(', ')})`,
)
