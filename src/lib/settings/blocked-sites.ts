/**
 * The blocked-sites list: patterns of pages Browsentic never reads or acts on.
 *
 * It lives in this browser's `storage.local` and nowhere else. No socket frame carries it,
 * so neither the daemon nor the agent it spawns can see or loosen it — the extension checks
 * it before every page action, whoever asked for that action.
 */

export const BLOCKED_SITES_KEY = 'browsentic/blockedSites';

export const BLOCKED_SITES_LIMITS = { entries: 500, length: 200 } as const;

export const SITE_BLOCKED = 'SITE_BLOCKED';

export const SITE_BLOCKED_MESSAGE =
  'This site is on the user’s Blocked sites list, so Browsentic will not read or act on it. ' +
  'Do not retry or reach it another way (another URL, a search, another tab) — tell the user, or carry on with work that does not need it.';

export const LIST_UNREADABLE_MESSAGE =
  'Browsentic could not read the user’s Blocked sites list, so it is refusing page actions until it can. ' +
  'Ask the user to open Settings → Blocked sites.';

export interface BlockedPattern {
  readonly pattern: string;
  readonly source: string;
  readonly regex: RegExp;
  readonly site: RegExp;
}

export type ParsedPattern =
  | { readonly ok: true; readonly pattern: string; readonly source: string }
  | { readonly ok: false; readonly reason: string };

interface PatternParts {
  readonly host: string;
  readonly port?: string;
  readonly path?: string;
}

const WEB_SCHEME = /^(?:https?|\*):\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DEFAULT_PORTS = new Set(['80', '443']);
const WILDCARD_HOST = /^[a-z0-9*.-]+$/;
const BOUNDARY = '(?:[/?&;].*)?$';

export function parseBlockedPattern(entry: string): ParsedPattern {
  const parts = partsOf(entry);
  if ('reason' in parts) return { ok: false, reason: parts.reason };
  return { ok: true, pattern: patternOf(parts), source: sourceOf(parts) };
}

/** `null` when the stored value is not a list at all — the caller must refuse, not guess. */
export function compileBlockedSites(raw: unknown): BlockedPattern[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const parts = partsOf(entry);
    if ('reason' in parts) return [];
    const source = sourceOf(parts);
    const site = new RegExp(`${siteSource(parts)}$`, 'i');
    return [{ pattern: patternOf(parts), source, regex: new RegExp(source, 'i'), site }];
  });
}

/** The patterns that could match somewhere on this origin — all a page on it ever needs to be told. */
export function patternsFor(origin: string, list: readonly BlockedPattern[]): BlockedPattern[] {
  const site = subjectOf(`${origin}/`)?.slice(0, -1);
  return site === undefined ? [] : list.filter((pattern) => pattern.site.test(site));
}

export function blockedBy(url: string | undefined, list: readonly BlockedPattern[]): string | null {
  const subject = subjectOf(url);
  if (subject === null) return null;
  return list.find(({ regex }) => regex.test(subject))?.pattern ?? null;
}

/** What a pattern is matched against: host, port and path with the query — never the hash. */
export function subjectOf(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/\.+$/, '');
  return `${host}${parsed.port ? `:${parsed.port}` : ''}${normalizePath(parsed.pathname)}${parsed.search}`;
}

export function describePattern(pattern: string): string {
  const parsed = partsOf(pattern);
  if ('reason' in parsed) return pattern;
  const { host, port, path } = parsed;
  const name = host.includes('*') ? `sites matching ${host}` : hasSubdomains(host) ? `${host} and its subdomains` : host;
  const site = `${name}${port ? `, port ${port}` : ''}`;
  if (!path) return `Every page on ${site}`;
  return `${path.includes('*') ? 'Pages matching' : 'Pages under'} ${path} on ${site}`;
}

const hasSubdomains = (host: string): boolean => host.includes('.') && !/^[\d.]+$|^\[/.test(host);

function partsOf(entry: string): PatternParts | { reason: string } {
  const trimmed = entry.trim();
  if (!trimmed) return { reason: 'Type a site, like example.com.' };
  if (trimmed.length > BLOCKED_SITES_LIMITS.length) {
    return { reason: `Keep it under ${BLOCKED_SITES_LIMITS.length} characters.` };
  }
  if (/\s/.test(trimmed)) return { reason: 'A pattern has no spaces.' };
  if (!WEB_SCHEME.test(trimmed) && ANY_SCHEME.test(trimmed)) {
    return { reason: 'Only web pages (http and https) can be blocked.' };
  }

  const bare = trimmed.replace(WEB_SCHEME, '').replace(/#.*$/, '');
  const split = bare.search(/[/?]/);
  const authority = (split === -1 ? bare : bare.slice(0, split)).toLowerCase();
  const rest = split === -1 ? '' : bare.slice(split);

  if (authority.includes('@')) return { reason: 'Leave out any user name — block the site itself.' };
  const hostPort = /^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hostPort || Number(hostPort[2] ?? 0) > 65535) {
    return { reason: 'That is not a site name, like example.com or localhost:3000.' };
  }

  const host = normalizeHost(hostPort[1]);
  if (!host) return { reason: 'That is not a site name, like example.com or localhost:3000.' };
  if (/^[*.]+$/.test(host)) return { reason: 'That would block every site.' };

  const port = hostPort[2] && !DEFAULT_PORTS.has(hostPort[2]) ? String(Number(hostPort[2])) : undefined;
  const path = normalizePatternPath(rest);
  return { host, ...(port ? { port } : {}), ...(path ? { path } : {}) };
}

function normalizeHost(raw: string): string | null {
  const host = raw.replace(/\.+$/, '').replace(/^\*\./, '');
  const dropped = host.startsWith('www.') && host.slice(4).includes('.') ? host.slice(4) : host;
  if (!dropped) return null;
  if (!dropped.includes('*')) return asciiHost(dropped);
  const labels = dropped.split('.').map((label) => (label.includes('*') ? label : asciiHost(label)));
  if (labels.some((label) => !label || !WILDCARD_HOST.test(label))) return null;
  return labels.join('.');
}

function asciiHost(host: string): string | null {
  try {
    return new URL(`http://${host}/`).hostname.replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

function normalizePatternPath(rest: string): string | undefined {
  if (!rest) return undefined;
  const withSlash = rest.startsWith('?') ? `/${rest}` : rest;
  const query = withSlash.indexOf('?');
  const pathname = normalizePath(query === -1 ? withSlash : withSlash.slice(0, query)).replace(/(.)\/$/, '$1');
  const path = `${pathname}${query === -1 ? '' : withSlash.slice(query)}`;
  return path === '/' ? undefined : path;
}

/** Collapses `//` and decodes escapes that spell plain characters, so `/%61dmin` is `/admin`. */
function normalizePath(path: string): string {
  return path
    .replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[a-z0-9\-._~]/i.test(char) ? char : escape;
    })
    .replace(/\/{2,}/g, '/');
}

function patternOf({ host, port, path }: PatternParts): string {
  return `${host}${port ? `:${port}` : ''}${path ?? ''}`;
}

function sourceOf(parts: PatternParts): string {
  return `${siteSource(parts)}${pathSource(parts.path)}`;
}

function siteSource({ host, port }: PatternParts): string {
  return `^(?:[^/:]*\\.)?${glob(host, '[^/:]*')}${port ? `:${port}` : '(?::\\d+)?'}`;
}

function pathSource(path: string | undefined): string {
  if (!path) return BOUNDARY;
  return `${glob(path, '.*')}${path.endsWith('*') ? '$' : BOUNDARY}`;
}

function glob(text: string, star: string): string {
  return text
    .split('*')
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join(star);
}
