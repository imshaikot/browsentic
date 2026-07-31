#!/usr/bin/env node
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = join(root, 'node_modules/.cache/voicelink-security');

async function bundle(entry, name) {
  const outfile = join(cache, `${name}.mjs`);
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
    alias: { '@': root },
  });
  return import(pathToFileURL(outfile).href);
}

const sitemap = await bundle('mcp/src/agent/sitemap.ts', 'sitemap');
const effects = await bundle('mcp/src/agent/effects.ts', 'effects');
const redact = await bundle('lib/bridge/redact.ts', 'redact');

let failed = 0;
let ran = 0;

function check(label, actual, expected) {
  ran++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`✗ ${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`);
  }
}

const PRIVATE = [
  '10.0.0.1', '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.1',
  '192.168.1.1', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::1', '::', '0:0:0:0:0:0:0:1',
  'fc00::1', 'fd12:3456::1',
  'fe80::1', 'fe90::1', 'fea0::1', 'febf::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
  '::127.0.0.1', '2002:7f00:1::', '64:ff9b::a9fe:a9fe',
  'fec0::1', 'ff02::1',
  '', 'not-an-ip', '1.2.3', '999.1.1.1',
];

const PUBLIC = [
  '8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '192.169.1.1', '198.20.0.1', '223.255.255.255',
  '2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:0808:0808::', '64:ff9b::808:808',
];

for (const address of PRIVATE) check(`isPrivateAddress(${address || '""'}) → true`, sitemap.isPrivateAddress(address), true);
for (const address of PUBLIC) check(`isPrivateAddress(${address}) → false`, sitemap.isPrivateAddress(address), false);

const seed = { origin: 'https://example.com', protocol: 'https:', hostname: 'example.com', port: '', address: '93.184.216.34', family: 4 };
const ALLOWED = [
  ['https://example.com/sitemap.xml', true],
  ['https://EXAMPLE.com/a', true],
  ['http://example.com/a', false],
  ['https://evil.com/a', false],
  ['https://example.com:8443/a', false],
  ['https://169.254.169.254/latest/meta-data', false],
  ['https://sub.example.com/a', false],
];
for (const [href, want] of ALLOWED) check(`allowed(${href})`, sitemap.allowed(new URL(href), seed), want);

const SUBMITS = [
  ['page.submitForm', {}, true],
  ['page.fillInput', { value: 'x', pressEnter: true }, true],
  ['page.fillInput', { value: 'x' }, false],
  ['page.pressKey', { key: 'Enter' }, true],
  ['page.pressKey', { key: 'Escape' }, false],
  ['page.clickElement', { target: { text: 'Place order' } }, false],
];
for (const [action, input, want] of SUBMITS) check(`submitsForm(${action})`, effects.submitsForm(action, input), want);

check('needsApproval fillInput+pressEnter', effects.needsApproval(['page.submitForm'], 'page.fillInput', { pressEnter: true }), true);
check('needsApproval disabled when list empty', effects.needsApproval([], 'page.fillInput', { pressEnter: true }), false);

const r = redact.redactInput;
check('fillInput value redacted', r('page.fillInput', { value: 'hunter2' }).value, '[redacted]');
check('password key redacted', r('page.x', { password: 'p' }).password, '[redacted]');
check('card number redacted', r('page.x', { note: '4242424242424242' }).note, '[redacted]');
check('benign value kept', r('page.x', { target: { text: 'Sign in' } }).target.text, 'Sign in');
check('long string clipped', r('page.x', { s: 'a'.repeat(500) }).s.length, 201);
check('array capped', r('page.x', { a: new Array(100).fill('x') }).a.length, 21);
check('deep nest cut', r('page.x', { a: { b: { c: { d: { e: 1 } } } } }).a.b.c.d, '[…]');

const server = createServer((req, res) => {
  if (req.url === '/plain') return res.writeHead(200).end('hello sitemap');
  if (req.url === '/redirect') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
  if (req.url === '/big') return res.writeHead(200).end('x'.repeat(5 * 1024 * 1024));
  if (req.url === '/gz') return res.writeHead(200).end(gzipSync(Buffer.from('gzipped body')));
  res.writeHead(404).end();
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = String(server.address().port);
const local = { origin: `http://127.0.0.1:${port}`, protocol: 'http:', hostname: '127.0.0.1', port, address: '127.0.0.1', family: 4 };

const fresh = () => ({ bytes: 0, documents: 0 });
const live = new AbortController();
check('live plain body', await sitemap.get(`${local.origin}/plain`, local, fresh(), live.signal), 'hello sitemap');
check('live redirect to metadata refused', await sitemap.get(`${local.origin}/redirect`, local, fresh(), live.signal), null);
check('live gzip round-trips', await sitemap.get(`${local.origin}/gz`, local, fresh(), live.signal), 'gzipped body');
const big = await sitemap.get(`${local.origin}/big`, local, fresh(), live.signal);
check('live oversize truncated', big !== null && big.length <= 4 * 1024 * 1024, true);
check('live off-origin refused', await sitemap.get('http://169.254.169.254/', local, fresh(), live.signal), null);

server.close();
await rm(cache, { recursive: true, force: true });

console.log(failed ? `${failed}/${ran} checks failed` : `${ran}/${ran} security checks passed`);
process.exit(failed ? 1 : 0);
