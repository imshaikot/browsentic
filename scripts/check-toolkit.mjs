#!/usr/bin/env node

/**
 * The two-world protocol behind page.injectCode.
 *
 * The toolkit is installed into the page's main world and called from the content
 * script's isolated one, so nothing about it is exercised by `tsc` — a broken installer
 * string or a dropped reply looks exactly like working code until a real page runs it.
 * Node has an EventTarget and a CustomEvent, which is all the protocol actually needs,
 * so the real installer source is evaluated here and called through the real client.
 */

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'node_modules/.cache/browsentic-toolkit/toolkit.mjs');
await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [join(root, 'src/lib/actions/page/toolkit.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  alias: { '@': join(root, 'src') },
});
const toolkit = await import(pathToFileURL(outfile).href);

let failed = 0;
let ran = 0;
function check(label, actual, expected) {
  ran++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return console.log(`  ok  ${label}`);
  failed++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}

// A stand-in for the two worlds: one shared window/document, the way a real page has one.
function makeWorld() {
  const target = new EventTarget();
  const attributes = new Map();
  globalThis.window = target;
  globalThis.document = {
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name) ?? null,
      hasAttribute: (name) => attributes.has(name),
      removeAttribute: (name) => attributes.delete(name),
    },
  };
  return { attributes, target };
}

const world = makeWorld();

// The main world evaluates exactly the string CDP would hand it.
const install = (id, code) => (0, eval)(toolkit.installerSource(id, code));

// ── installing ───────────────────────────────────────────────────────────────
const names = install('kit-1', `
  tools.echo = (value) => value;
  tools.add = (a, b) => a + b;
  tools.slow = async (ms) => { await new Promise((d) => setTimeout(d, ms)); return 'late'; };
  tools.boom = () => { throw new Error('page said no'); };
  tools.nothing = () => undefined;
  tools.cyclic = () => { const o = {}; o.self = o; return o; };
  const helper = 1;
`);
check('install reports only the functions', names.sort(), ['add', 'boom', 'cyclic', 'echo', 'nothing', 'slow']);
check('install stamps the attribute', world.attributes.get('data-browsentic-toolkit'), 'kit-1');

// ── calling across the bridge ────────────────────────────────────────────────
check('a value round trips', await toolkit.callToolkit('echo', [{ a: [1, 2] }], 1000), { a: [1, 2] });
check('several arguments arrive in order', await toolkit.callToolkit('add', [2, 40], 1000), 42);
check('an async function is awaited', await toolkit.callToolkit('slow', [10], 1000), 'late');
check('undefined comes back as null', await toolkit.callToolkit('nothing', [], 1000), null);

const thrown = await toolkit.callToolkit('boom', [], 1000).catch((e) => e);
check('a throw surfaces as CODE_ERROR', [thrown.code, thrown.message.includes('page said no')], ['CODE_ERROR', true]);

const missing = await toolkit.callToolkit('nope', [], 1000).catch((e) => e);
check('an unknown function is rejected by the page', missing.code, 'CODE_ERROR');

const unserializable = await toolkit.callToolkit('cyclic', [], 1000).catch((e) => e);
check('a non-JSON return is reported, not hung', unserializable.code, 'CODE_ERROR');

const late = await toolkit.callToolkit('slow', [500], 120).catch((e) => e);
check('a slow call times out', late.code, 'TIMEOUT');

// A timed-out call must not leave its listener behind to catch the next reply.
await new Promise((done) => setTimeout(done, 600));
check('the abandoned call did not corrupt the next one', await toolkit.callToolkit('add', [1, 1], 1000), 2);

// ── re-installing over a live toolkit ────────────────────────────────────────
const second = install('kit-2', `tools.echo = () => 'replaced';`);
check('re-install swaps the toolkit', second, ['echo']);
check('re-install restamps the id', world.attributes.get('data-browsentic-toolkit'), 'kit-2');
check('the new function answers', await toolkit.callToolkit('echo', [], 1000), 'replaced');
const gone = await toolkit.callToolkit('add', [1, 1], 1000).catch((e) => e);
check('the old function is gone', gone.code, 'CODE_ERROR');

// ── a page with no toolkit ───────────────────────────────────────────────────
makeWorld();
let bare;
try {
  await toolkit.callToolkit('echo', [], 1000);
} catch (error) {
  bare = error;
}
check('calling into a bare page reports TOOLKIT_MISSING', bare.code, 'TOOLKIT_MISSING');

// ── code that defines nothing ────────────────────────────────────────────────
makeWorld();
let empty;
try {
  install('kit-3', `const x = 1;`);
} catch (error) {
  empty = error;
}
check('code defining no functions throws at install', empty.message.includes('no functions'), true);

// ── the Live tool switch decides whether the agent is even told ──────────────
const skillsOut = join(root, 'node_modules/.cache/browsentic-toolkit/skills.mjs');
await build({
  entryPoints: [join(root, 'src/daemon/agent/skills.ts')],
  outfile: skillsOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  logLevel: 'warning',
  alias: { '@': join(root, 'src') },
});
const { routeSkill, SCRIPTING_SKILL } = await import(pathToFileURL(skillsOut).href);

const skill = (name, extra = {}) => ({
  name,
  description: '',
  triggers: ['20', 'every'],
  isDefault: name === 'browser-control',
  category: 'general',
  domains: [],
  source: 'bundled',
  provenance: 'authored',
  body: name,
  ...extra,
});
const library = [skill('browser-control'), skill(SCRIPTING_SKILL)];
const route = (context) => routeSkill(library, 'create 20 tags, every one of them', context);

check('with the switch off the scripting skill is not attached', route({}).overlays.map((s) => s.name), []);
check('with the switch off the base skill is unaffected', route({}).base.name, 'browser-control');
check('with the switch on it rides along as an overlay', route({ liveTools: true }).overlays.map((s) => s.name), [SCRIPTING_SKILL]);
check('it never replaces the base skill it advises against', route({ liveTools: true }).base.name, 'browser-control');
check('no context at all means off', routeSkill(library, 'create 20 tags').overlays.map((s) => s.name), []);

console.log(failed ? `\n${failed} of ${ran} failed` : `\n${ran}/${ran} toolkit checks passed`);
process.exit(failed ? 1 : 0);
