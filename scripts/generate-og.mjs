// Renders scripts/og.html to public/og.png. og.png is committed, so CI never needs a browser.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const chrome = CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH to a Chromium binary and re-run.')
  process.exit(1)
}

// Reused profile: a fresh one costs minutes of first-launch setup per run.
const profile = join(tmpdir(), 'browsentic-og-profile')
const shot = join(tmpdir(), `browsentic-og-${process.pid}.png`)
mkdirSync(profile, { recursive: true })

const source = pathToFileURL(join(root, 'scripts', 'og.html')).href

const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-background-networking',
    // Web fonts arrive over the network; without a beat the shot catches the fallback.
    '--virtual-time-budget=5000',
    `--user-data-dir=${profile}`,
    `--screenshot=${shot}`,
    source,
  ],
  { stdio: 'ignore' },
)

// execFileSync's timeout does not reap a Chrome that has already forked helpers.
const watchdog = setTimeout(() => {
  console.error('Chrome exceeded 180s — killing it.')
  child.kill('SIGKILL')
}, 180_000)

child.on('exit', () => {
  clearTimeout(watchdog)
  if (!existsSync(shot)) {
    console.error('Chrome produced no screenshot. Re-run, or set CHROME_PATH.')
    process.exit(1)
  }
  renameSync(shot, join(root, 'public', 'og.png'))
  rmSync(shot, { force: true })
  console.log('wrote public/og.png')
})
