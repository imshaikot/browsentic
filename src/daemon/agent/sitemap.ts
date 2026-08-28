import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
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
  family: 4 | 6;
}

async function pinOrigin(origin: string): Promise<Seed> {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported scheme ${url.protocol}`);
  const address = await resolveOnce(url.hostname);
  if (isPrivateAddress(address)) throw new Error(`${url.hostname} resolves to the private address ${address}`);
  return {
    origin: url.origin,
    protocol: url.protocol,
    hostname: url.hostname.toLowerCase(),
    port: url.port,
    address,
    family: isIP(address) === 6 ? 6 : 4,
  };
}

async function resolveOnce(hostname: string): Promise<string> {
  if (isIP(hostname)) return hostname;
  const { address } = await lookup(hostname);
  return address;
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_hostname, options, callback) => {
    const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    if (all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
    else (callback as unknown as (e: null, a: string, f: number) => void)(null, address, family);
  }) as LookupFunction;
}

export async function get(
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
    if (!allowed(url, seed)) {
      log(`sitemap: refused ${url.href} (not the mapped origin)`);
      return null;
    }
    const hopResult = await send(url, seed, budget, signal);
    if (!hopResult) return null;
    if (hopResult.status >= 300 && hopResult.status < 400) {
      if (!hopResult.location || hop === MAX_REDIRECTS) return null;
      try {
        url = new URL(hopResult.location, url);
      } catch {
        return null;
      }
      continue;
    }
    if (!hopResult.body) return null;
    return decode(hopResult.body, url);
  }
  return null;
}

export function allowed(url: URL, seed: Seed): boolean {
  if (url.protocol !== seed.protocol) return false;
  if (url.hostname.toLowerCase() !== seed.hostname) return false;
  return url.port === seed.port;
}

interface Hop {
  status: number;
  location: string | null;
  body: Buffer | null;
}

function send(
  url: URL,
  seed: Seed,
  budget: { bytes: number; documents: number },
  signal: AbortSignal,
): Promise<Hop | null> {
  return new Promise<Hop | null>((resolve) => {
    const call = url.protocol === 'https:' ? httpsRequest : httpRequest;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: Hop | null) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };

    const req = call(url, {
      method: 'GET',
      lookup: pinnedLookup(seed.address, seed.family),
      headers: {
        accept: 'text/plain,application/xml,text/xml,*/*',
        'accept-encoding': 'identity',
      },
    });

    function onAbort() {
      req.destroy();
      finish(null);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    deadline = setTimeout(onAbort, REQUEST_TIMEOUT_MS);

    req.on('error', () => finish(null));

    req.on('response', (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const raw = res.headers.location;
        res.destroy();
        return finish({ status, location: typeof raw === 'string' ? raw : null, body: null });
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        return finish(null);
      }
      budget.documents++;
      readCapped(res, budget).then((body) => finish({ status, location: null, body }));
    });

    req.end();
  });
}

function readCapped(res: IncomingMessage, budget: { bytes: number }): Promise<Buffer> {
  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    };
    res.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      budget.bytes += chunk.byteLength;
      if (size > MAX_DOC_BYTES || budget.bytes > MAX_TOTAL_BYTES) {
        res.destroy();
        return settle();
      }
      chunks.push(chunk);
    });
    res.on('end', settle);
    res.on('aborted', settle);
    res.on('error', settle);
  });
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

function expandV6(address: string): number[] | null {
  const bare = address.split('%')[0].toLowerCase();
  const [head, tail, ...rest] = bare.split('::');
  if (rest.length) return null;

  const toGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        const quad = piece.split('.').map(Number);
        if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  if (!left || !right) return null;
  if (tail === undefined) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function v4From(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const g = expandV6(address);
    if (!g) return true;
    if (g.every((part) => part === 0)) return true;
    if (g.slice(0, 7).every((part) => part === 0) && g[7] === 1) return true;
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    if (g[0] === 0x2002) return isPrivateAddress(v4From(g[1], g[2]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isPrivateAddress(v4From(g[6], g[7]));
    }
    if (g.slice(0, 5).every((part) => part === 0) && (g[5] === 0xffff || g[5] === 0)) {
      return isPrivateAddress(v4From(g[6], g[7]));
    }
    return false;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}
