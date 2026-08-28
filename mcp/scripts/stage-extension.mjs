#!/usr/bin/env node
// Copies the built extension into the package so it can ship in the npm tarball.
//
// npm's `files` allowlist cannot reference paths above the package root, and the extension
// builds to <repo>/dist/chrome-mv3 — a sibling of mcp/, not a descendant. So it has to be
// staged inward before packing.
//
// This runs as `prepack`, which means it runs for `npm pack` and `npm publish` alike, so a
// maintainer packing locally gets exactly what CI publishes. It stages and validates only;
// it never builds. Building from here would mean shelling out to the vendored Yarn from
// inside an npm lifecycle script, which is fragile and would diverge from CI.
//
// Every failure below is fatal on purpose. A tarball that is merely missing its extension,
// or carrying a stale one, installs cleanly and fails much later in someone else's browser.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(PKG, '..', 'dist', 'chrome-mv3')
const TARGET = path.join(PKG, 'extension', 'chrome-mv3')

const die = (message, hint) => {
  console.error(`\nstage-extension: ${message}`)
  if (hint) console.error(`  ${hint}`)
  console.error()
  process.exit(1)
}

const manifestPath = path.join(SOURCE, 'manifest.json')
if (!existsSync(manifestPath)) {
  die(
    `no extension build at ${SOURCE}`,
    'The npm package cannot ship without it. Run `yarn build` at the repository root first.',
  )
}

if (!existsSync(path.join(PKG, 'dist', 'cli.js'))) {
  die('no daemon build at mcp/dist/cli.js', 'Run `yarn mcp:build` first.')
}

// The one that actually bites: publishing a new daemon beside a stale extension. It installs
// fine, then reports a drifted manifest hash from inside the user's browser, where the cause
// is invisible. WXT stamps the manifest from the root package.json at build time, so a
// mismatch means the extension was not rebuilt after the version bump.
const built = JSON.parse(readFileSync(manifestPath, 'utf8')).version
const declared = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')).version
if (built !== declared) {
  die(
    `the built extension is ${built} but this package is ${declared}`,
    'Rebuild the extension after bumping the version: `yarn build` at the repository root.',
  )
}

rmSync(path.join(PKG, 'extension'), { recursive: true, force: true })
mkdirSync(path.dirname(TARGET), { recursive: true })
cpSync(SOURCE, TARGET, { recursive: true })

const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const full = path.join(dir, entry.name)
    return total + (entry.isDirectory() ? bytes(full) : statSync(full).size)
  }, 0)

const count = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (total, entry) => total + (entry.isDirectory() ? count(path.join(dir, entry.name)) : 1),
    0,
  )

console.log(
  `stage-extension: extension/chrome-mv3 — ${count(TARGET)} files, ` +
    `${(bytes(TARGET) / 1024 / 1024).toFixed(2)} MB, manifest v${built}`,
)
