#!/usr/bin/env node
/**
 * Run the local intent funnel (`lib/intent/`) over a table of utterances and check each one
 * routes where it should. This is where ACT_THRESHOLD is tuned: the summary prints the
 * margin on both sides of it, so raising or lowering it is an evidence-backed edit.
 *
 * The funnel is pure TypeScript with no DOM and no `browser.*`, so it can be bundled and run
 * in plain Node — which also proves the module stays free of extension-only imports.
 *
 * Usage: npm run intent:check [-- "an utterance to route"]
 */
import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Each case is `[utterance, 'act:<ruleId>' | 'escalate:<reason>', expectedInput?]`.
 * Cases exist for the decisions worth defending, in both directions — a grammar that only
 * proves what it catches is half-checked.
 */
const CASES = [
  // ── History ────────────────────────────────────────────────────────────────
  ['back', 'act:history.back', { action: 'back' }],
  ['go back', 'act:history.back'],
  ['Hey VoiceLink, could you go back please?', 'act:history.back'],
  ['back a page', 'act:history.back'],
  ['go forward', 'act:history.forward', { action: 'forward' }],
  ['reload', 'act:history.reload', { action: 'reload' }],
  ['refresh the page', 'act:history.reload'],
  ['reload this page.', 'act:history.reload'],

  // ── Navigation ─────────────────────────────────────────────────────────────
  ['go to github.com', 'act:navigate.url', { url: 'https://github.com' }],
  ['open github dot com', 'act:navigate.url', { url: 'https://github.com' }],
  ['visit https://example.com/docs', 'act:navigate.url', { url: 'https://example.com/docs' }],
  ['go to youtube', 'act:navigate.url', { url: 'https://youtube.com' }],
  ['open gmail', 'act:navigate.url', { url: 'https://mail.google.com' }],
  ['take me to hacker news', 'act:navigate.url', { url: 'https://news.ycombinator.com' }],
  ['open localhost:3000', 'act:navigate.url', { url: 'http://localhost:3000' }],
  ['navigate to example.co.uk', 'act:navigate.url'],
  ['google best noise cancelling headphones', 'act:navigate.search'],
  ['search the web for tide times', 'act:navigate.search'],

  // ── Scrolling ──────────────────────────────────────────────────────────────
  ['scroll down', 'act:scroll.direction', { direction: 'down' }],
  ['scroll down a bit', 'act:scroll.direction'],
  ['can you scroll down?', 'act:scroll.direction'],
  ['scroll to the top', 'act:scroll.direction', { direction: 'top' }],
  ['go to the bottom of the page', 'act:scroll.direction', { direction: 'bottom' }],
  ['jump to the top', 'act:scroll.direction'],
  ['page down', 'act:scroll.page', { direction: 'down' }],
  ['scroll to the reviews', 'act:scroll.element', { target: { text: 'reviews' } }],

  // ── Keys ───────────────────────────────────────────────────────────────────
  ['press enter', 'act:key.press', { key: 'Enter' }],
  ['hit escape', 'act:key.press', { key: 'Escape' }],
  ['press the tab key', 'act:key.press', { key: 'Tab' }],
  ['press arrow down', 'act:key.press', { key: 'ArrowDown' }],

  // ── Clicks ─────────────────────────────────────────────────────────────────
  ['click sign in', 'act:click.text', { target: { text: 'sign in' } }],
  ['Click the Sign In button', 'act:click.text', { target: { text: 'sign in', role: 'button' } }],
  ['tap continue', 'act:click.text'],
  ['click on next', 'act:click.text'],
  ['click terms and conditions', 'act:click.text', { target: { text: 'terms and conditions' } }],

  // ── Questions and reading: only the agent can answer ───────────────────────
  ['what is on this page', 'escalate:question'],
  ['summarize this article', 'escalate:question'],
  ['is there a login button?', 'escalate:question'],
  ['back?', 'escalate:question'],
  ['read me the reviews', 'escalate:question'],
  ['find the cheapest flight', 'escalate:question'],

  // ── More than one step ─────────────────────────────────────────────────────
  ['click sign in and then fill in my email', 'escalate:multi-step'],
  ['scroll down and tell me what it says', 'escalate:no-match'],
  ['press the red button and then wait', 'escalate:multi-step'],

  // ── Conditions need the page to be looked at ───────────────────────────────
  ['click sign in if you see it', 'escalate:conditional'],
  ['reload the page unless it already loaded', 'escalate:conditional'],

  // ── Consequential: the agent's approval gate should see these ──────────────
  ['click buy now', 'escalate:consequential'],
  ['click the submit button', 'escalate:consequential'],
  ['click send', 'escalate:consequential'],
  ['click delete', 'escalate:consequential'],

  // ── Understood shape, unusable slot ────────────────────────────────────────
  ['click it', 'escalate:below-threshold'],
  ['click the blue one at the bottom of the sidebar', 'escalate:below-threshold'],
  ['open the settings menu', 'escalate:no-match'],
  ['take me to the checkout page', 'escalate:no-match'],
  ['google maps', 'escalate:no-match'],
  ['search for wireless headphones', 'escalate:no-match'],
  ['log into my account', 'escalate:no-match'],
  ['buy it now', 'escalate:no-match'],
  ['', 'escalate:no-match'],
  ['hey voicelink', 'escalate:no-match'],

  // ── Explicit skill routing always reaches the agent ────────────────────────
  ['@shopping go to amazon.com', 'escalate:skill-prefix'],
];

const outfile = join(root, 'node_modules/.cache/voicelink/intent-check.mjs');
await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [join(root, 'lib/intent/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  // The same `@/*` → repo root alias the extension build and the MCP daemon use.
  alias: { '@': root },
});

const { routeIntent, ACT_THRESHOLD } = await import(pathToFileURL(outfile).href);
await rm(dirname(outfile), { recursive: true, force: true });

const ask = process.argv.slice(2).join(' ').trim();
if (ask) {
  console.log(`${ask}\n${JSON.stringify(routeIntent(ask), null, 2)}`);
  process.exit(0);
}

let failed = 0;
let lowestAct = Infinity;
let highestEscalate = 0;

for (const [say, expected, expectedInput] of CASES) {
  const routing = routeIntent(say);
  const got =
    routing.decision === 'act' ? `act:${routing.intent.ruleId}` : `escalate:${routing.reason}`;
  const inputMismatch =
    expectedInput && JSON.stringify(routing.intent?.input) !== JSON.stringify(expectedInput);

  if (routing.decision === 'act') lowestAct = Math.min(lowestAct, routing.intent.score);
  // Only the threshold's own verdicts bound it. A hard stop (a question, a consequential
  // click) can score high and still escalate, and says nothing about where the line sits.
  else if (routing.reason === 'below-threshold') highestEscalate = Math.max(highestEscalate, routing.score);

  if (got !== expected || inputMismatch) {
    failed++;
    console.log(`✗ ${JSON.stringify(say)}\n    expected ${expected}, got ${got}`);
    if (inputMismatch) {
      console.log(`    input    ${JSON.stringify(routing.intent?.input)}`);
      console.log(`    wanted   ${JSON.stringify(expectedInput)}`);
    }
  }
}

const acting = CASES.filter(([, e]) => e.startsWith('act:')).length;
console.log(
  `\n${CASES.length - failed}/${CASES.length} routed as expected` +
    ` (${acting} handled locally, ${CASES.length - acting} escalated)`,
);
console.log(
  `threshold ${ACT_THRESHOLD} sits in (${highestEscalate.toFixed(3)}, ${lowestAct.toFixed(3)}] — ` +
    'the band between the best case it rejects and the worst it accepts',
);
if (failed) console.log(`\n${failed} case(s) failed`);
process.exit(failed ? 1 : 0);
