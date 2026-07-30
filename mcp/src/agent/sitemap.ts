import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { log } from '../log';

const MAX_DOCUMENTS = 20;
const MAX_DOC_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_URLS = 5_000;
const MAX_PATHS = 200;
const MAX_PATTERNS = 12;
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EVIDENCE_BYTES = 512 * 1024;

export interface SiteIndex {
  source: 'robots' | 'sitemap.xml' | 'sitemap-index' | 'none';
  documents: number;
  urlCount: number;
  truncated: boolean;
  paths: string[];
  patterns: { pattern: string; count: number; example: string }[];
  raw: string;
}

const EMPTY: SiteIndex = {
  source: 'none',
  documents: 0,
  urlCount: 0,
  truncated: false,
  paths: [],
  patterns: [],
  raw: '',
};

export async function fetchSiteIndex(origin: string, signal: AbortSignal): Promise<SiteIndex> {
  let seed: Seed;
  try {
    seed = await pinOrigin(origin);
  } catch (error) {
    log(`sitemap: refusing to fetch ${origin}: ${String(error)}`);
    return EMPTY;
  }

  const budget = { bytes: 0, documents: 0 };
  const evidence: string[] = [];
  const urls: string[] = [];
  let source: SiteIndex['source'] = 'none';
  let truncated = false;

  const robots = await get(`${seed.origin}/robots.txt`, seed, budget, signal);
  if (robots) evidence.push(`# ${seed.origin}/robots.txt\n${robots}`);

  const declared = robots ? sitemapDirectives(robots) : [];
  const candidates = declared.length
    ? declared
    : [`${seed.origin}/sitemap.xml`, `${seed.origin}/sitemap_index.xml`, `${seed.origin}/sitemap-index.xml`];
  if (declared.length) source = 'robots';

  const queue = [...candidates];
  const seen = new Set<string>();
  while (!signal.aborted && queue.length && budget.documents < MAX_DOCUMENTS && urls.length < MAX_URLS) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);

    const body = await get(next, seed, budget, signal);
    if (!body) continue;
    if (evidence.length < 2) evidence.push(`# ${next}\n${body}`);
    if (source === 'none') source = 'sitemap.xml';

    if (/<sitemapindex[\s>]/i.test(body) && seen.size <= candidates.length) {
      source = 'sitemap-index';
      for (const child of locs(body)) {
        if (queue.length + seen.size >= MAX_DOCUMENTS) break;
        queue.push(child);
      }
      continue;
    }
    for (const loc of locs(body)) {
      if (urls.length >= MAX_URLS) {
        truncated = true;
        break;
      }
      urls.push(loc);
    }
  }

  const paths = pathsOf(urls, seed);
  return {
    source: urls.length ? source : 'none',
    documents: budget.documents,
    urlCount: urls.length,
    truncated: truncated || paths.length > MAX_PATHS,
    paths: paths.slice(0, MAX_PATHS),
    patterns: patternsOf(paths),
    raw: evidence.join('\n\n').slice(0, MAX_EVIDENCE_BYTES),
  };
}

interface Seed {
  origin: string;
  protocol: string;
  hostname: string;
  port: string;
  address: string;
  loopback: boolean;
}

async function pinOrigin(origin: string): Promise<Seed> {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported scheme ${url.protocol}`);
  const address = await resolveOnce(url.hostname);
  const loopback = isPrivateAddress(address);
  return {
    origin: url.origin,
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port,
    address,
    loopback,
  };
}

async function resolveOnce(hostname: string): Promise<string> {
  if (isIP(hostname)) return hostname;
  const { address } = await lookup(hostname);
  return address;
}

async function get(
  target: string,
  seed: Seed,
  budget: { bytes: number; documents: number },
  signal: AbortSignal,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await allowed(url, seed))) {
      log(`sitemap: refused ${url.href} (not the mapped origin, or a private address)`);
      return null;
    }
    const timer = new AbortController();
    const abort = () => timer.abort();
    signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: timer.signal,
        headers: { accept: 'text/plain,application/xml,text/xml,*/*' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) return null;
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body) return null;
      budget.documents++;
      const bytes = await readCapped(response.body, budget);
      return decode(bytes, url);
    } catch {
      return null;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
    }
  }
  return null;
}

async function allowed(url: URL, seed: Seed): Promise<boolean> {
  if (url.protocol !== seed.protocol) return false;
  if (url.hostname.toLowerCase() !== seed.hostname) return false;
  if (url.port !== seed.port) return false;
  const address = await resolveOnce(url.hostname).catch(() => '');
  if (!address || address !== seed.address) return false;
  return seed.loopback || !isPrivateAddress(address);
}

async function readCapped(body: ReadableStream<Uint8Array>, budget: { bytes: number }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.bytes += value.byteLength;
      if (size > MAX_DOC_BYTES || budget.bytes > MAX_TOTAL_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function decode(bytes: Buffer, url: URL): string {
  const gzipped = url.pathname.endsWith('.gz') || (bytes[0] === 0x1f && bytes[1] === 0x8b);
  if (!gzipped) return bytes.toString('utf8');
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_DOC_BYTES }).toString('utf8');
  } catch {
    log(`sitemap: refused to expand ${url.href} (over the decompressed size limit)`);
    return '';
  }
}

function sitemapDirectives(robots: string): string[] {
  return robots
    .split(/\r?\n/)
    .map((line) => /^\s*sitemap\s*:\s*(\S+)/i.exec(line)?.[1])
    .filter((value): value is string => !!value)
    .slice(0, MAX_DOCUMENTS);
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1]));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pathsOf(urls: string[], seed: Seed): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      if (url.protocol !== seed.protocol || url.hostname.toLowerCase() !== seed.hostname) continue;
      const path = url.pathname || '/';
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    } catch {
    }
  }
  return paths;
}

function patternsOf(paths: string[]): { pattern: string; count: number; example: string }[] {
  const groups = new Map<string, { count: number; example: string }>();
  for (const path of paths) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) continue;
    const shape = `/${segments
      .map((segment, index) => (index === 0 ? segment : placeholder(segment)))
      .join('/')}`;
    const group = groups.get(shape);
    if (group) group.count++;
    else groups.set(shape, { count: 1, example: path });
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_PATTERNS)
    .map(([pattern, group]) => ({ pattern, count: group.count, example: group.example }));
}

function placeholder(segment: string): string {
  if (/^\d+$/.test(segment)) return '{id}';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment)) return '{uuid}';
  return '{slug}';
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}
