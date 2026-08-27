// The site copy uses no em dashes. Nothing in a browser catches a regression here,
// so the build does. Run directly with `npm run check:copy`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Site copy only. src/docs/ is synced verbatim from `main` and follows that
// repository's conventions, not this one, so it is deliberately not scanned.
const ROOTS = ['src', 'scripts/og.html']
const SKIP = ['src/docs']
const BANNED = [
  { char: '—', name: 'em dash', hint: 'use a period, colon, comma or parentheses' },
]

const walk = (path) =>
  statSync(path).isDirectory()
    ? readdirSync(path).flatMap((entry) => walk(join(path, entry)))
    : [path]

const failures = []
for (const target of ROOTS) {
  for (const file of walk(join(root, target))) {
    const relative = file.slice(root.length + 1)
    if (SKIP.some((prefix) => relative.startsWith(prefix))) continue
    if (!/\.(js|njk|css|html)$/.test(file)) continue
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const { char, name, hint } of BANNED) {
          if (line.includes(char)) {
            failures.push(`${file.slice(root.length + 1)}:${i + 1}  ${name} (${hint})\n    ${line.trim()}`)
          }
        }
      })
  }
}

if (failures.length) {
  console.error(`Banned punctuation in ${failures.length} place(s):\n`)
  console.error(failures.join('\n\n'))
  process.exit(1)
}
console.log('copy check passed: no banned punctuation')
