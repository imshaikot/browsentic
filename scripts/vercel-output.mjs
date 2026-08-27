#!/usr/bin/env node
// Turns _site/ into a Build Output API v3 directory so `vercel deploy --prebuilt`
// uploads finished files and Vercel never runs a build of its own.
//
// Headers and redirects are read from vercel.json, so that file stays the single
// source of truth whether the deploy is prebuilt or (later) git-driven.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IN = path.join(SITE, '_site')
const OUT = path.join(SITE, '.vercel/output')

if (!existsSync(IN)) {
  console.error('vercel-output: _site does not exist — run `npm run build` first')
  process.exit(1)
}

const config = JSON.parse(await readFile(path.join(SITE, 'vercel.json'), 'utf8'))

// Build Output API expresses headers as routes that set them and carry on.
const routes = []

for (const rule of config.redirects ?? []) {
  routes.push({
    src: `^${rule.source}/?$`,
    headers: { Location: rule.destination },
    status: rule.permanent ? 308 : 307,
  })
}

routes.push({ handle: 'filesystem' })

for (const rule of config.headers ?? []) {
  routes.push({
    src: `^${rule.source.replace(/\/\(\.\*\)$/, '/(.*)')}$`,
    headers: Object.fromEntries(rule.headers.map((h) => [h.key, h.value])),
    continue: true,
  })
}

// Anything that reaches here is genuinely missing.
routes.push({ src: '^/(.*)$', status: 404, dest: '/404.html' })

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
await cp(IN, path.join(OUT, 'static'), { recursive: true })

await writeFile(
  path.join(OUT, 'config.json'),
  JSON.stringify({ version: 3, trailingSlash: config.trailingSlash ?? true, routes }, null, 2),
)

console.log(`vercel-output: .vercel/output ready (${routes.length} routes)`)
