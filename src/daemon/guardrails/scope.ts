/**
 * A run's blast radius: the hosts it may reach and the tab it may drive.
 *
 * Scope is derived once, when a run starts, from things the user controls — the tab
 * they were on, the words they typed, their config. It never widens on its own, and
 * nothing read from a page can widen it. That is the whole point: an injected
 * instruction can still be obeyed, but it has nowhere to send what it stole.
 */

const NAVIGATIONS = new Set(['page.navigate', 'page.openTab', 'page.captureDownload']);
const TAB_MOVES = new Set(['page.switchTab', 'page.closeTab']);

/** Endings that look like a host but are almost always a filename in prose. */
const NOT_A_HOST = new Set(['txt', 'md', 'json', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'zip', 'js', 'ts', 'sh', 'py']);

/** A bare domain or a URL sitting in the user's own sentence. */
const HOST_IN_TEXT = /(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(?=[/\s,;:!?)"'\]]|$)/gi;

export interface Scope {
  /** Hosts this run may navigate to. `['*']` means anywhere. */
  readonly hosts: readonly string[];
  /** Tab the run is pinned to. Undefined means the run may roam between tabs. */
  readonly tabId?: number;
  /** Tabs the run opened itself, which count as its own for the pinned-tab rule. */
  readonly ownedTabIds?: readonly number[];
}

/** No confinement. What an external MCP client gets: it has no run to be scoped to. */
export const ANYWHERE: Scope = { hosts: ['*'] };

export interface ScopeSeed {
  /** URL of the tab the run started on. */
  url?: string;
  /** Tab the run started on. Only pins the run when `pinTab` is set. */
  tabId?: number;
  /** The user's own words. Hosts they named are hosts they asked for. */
  instruction?: string;
  /** Standing allowlist from config. A single `'*'` disables host confinement. */
  extraHosts?: readonly string[];
  pinTab?: boolean;
}

/**
 * Derive a scope. A run that starts nowhere in particular — a blank tab, no host
 * named — comes back unconfined: confinement follows from having a starting point,
 * and failing closed there would block "search for X" on an empty tab.
 */
export function scopeFor(seed: ScopeSeed): Scope {
  const tabId = seed.pinTab ? seed.tabId : undefined;
  const hosts = new Set<string>();

  for (const host of seed.extraHosts ?? []) {
    if (host === '*') return { hosts: ['*'], tabId };
    const normalized = normalizeHost(host);
    if (normalized) hosts.add(normalized);
  }

  const start = hostOf(seed.url);
  if (start) hosts.add(start);

  for (const [, host] of (seed.instruction ?? '').matchAll(HOST_IN_TEXT)) {
    const normalized = normalizeHost(host);
    if (normalized && !NOT_A_HOST.has(normalized.split('.').pop()!)) hosts.add(normalized);
  }

  return hosts.size ? { hosts: [...hosts], tabId } : { hosts: ['*'], tabId };
}

/**
 * Lowercase, drop a trailing root dot, and drop a leading `www.` or `*.` so that a
 * scope of `example.com` covers `www.example.com` and `app.example.com`. Returns
 * null for anything that is not a bare host.
 */
export function normalizeHost(host: string): string | null {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\*\./, '').replace(/^www\./, '');
  if (!trimmed || /[^a-z0-9.\-[\]:]/.test(trimmed)) return null;
  return trimmed;
}

export function hostAllowed(host: string, hosts: readonly string[]): boolean {
  if (hosts.includes('*')) return true;
  const target = normalizeHost(host);
  if (!target) return false;
  return hosts.some((entry) => target === entry || target.endsWith(`.${entry}`));
}

function parseUrl(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

function hostOf(url: string | undefined): string | null {
  const parsed = url ? parseUrl(url) : null;
  return parsed ? normalizeHost(parsed.hostname) : null;
}

/**
 * Two origins that disagree with each other. Not a guess at where a run is — nothing is
 * ever compared against them — but the question put to the parser: does this string bring
 * its own host, or take one from whatever page it lands on? Two rather than one, so that
 * naming the probe cannot buy a reference the answer it wants. `.invalid` is reserved by
 * RFC 2606 and resolves nowhere.
 */
const PROBES = ['https://one.probe.invalid/', 'https://two.probe.invalid/'];
const PROBE_HOSTS = PROBES.map((base) => new URL(base).hostname);

/**
 * A navigation, and how much of the destination the caller's own string settles:
 *
 *   absolute   parses alone — scheme and host both came from the caller
 *   authority  only parses against a base, but brings its own host: `//evil.com/x` is
 *              evil.com whatever page it is typed on, and borrows only the scheme
 *   path       takes its host from the page it lands on and cannot change it
 *   opaque     nothing settles it, base or no base
 *
 * A path's `url` carries a probe's host. Read a host off one of these only when the kind
 * says the caller supplied it — `hostBearingUrl` is that question asked properly.
 */
export type NavigationTarget =
  | { readonly kind: 'absolute' | 'authority' | 'path'; readonly url: URL }
  | { readonly kind: 'opaque'; readonly url: null };

/**
 * The navigation an action is asking for, or null when it is not asking for one.
 *
 * This used to return the absolute URL and null for every string `new URL` refused, on
 * the reasoning that a relative URL resolves against the tab the run is already on and so
 * cannot change host. That holds for a path and is false for an authority: the extension
 * hands the string to the page's own resolver — `location.href` for page.navigate, the
 * anchor tab for page.openTab — so `//evil.com/x` on a bank's page is that resolver
 * handing the run to evil.com, and `\\evil.com/x`, `/\evil.com/x`, `///evil.com/x` and
 * every whitespace-prefixed spelling of them are the same URL. Every url condition read
 * the null and stayed quiet.
 *
 * Classifying separates a host the daemon cannot know from a host it was handed in a
 * spelling it did not recognise. The classifier is the parser itself, asked twice against
 * bases that disagree, so there is no list of tricks to keep up to date — and what still
 * will not resolve comes back `opaque` rather than as nothing to see.
 */
export function targetUrl(action: string, input: unknown): NavigationTarget | null {
  if (!NAVIGATIONS.has(action)) return null;
  const url = (input as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string') return null;

  const alone = parseUrl(url);
  if (alone) return { kind: 'absolute', url: alone };

  const [one, two] = PROBES.map((base) => parseUrl(url, base));
  if (!one || !two) return { kind: 'opaque', url: null };
  if (one.hostname === two.hostname) return { kind: 'authority', url: one };
  if (one.hostname === PROBE_HOSTS[0] && two.hostname === PROBE_HOSTS[1]) return { kind: 'path', url: one };
  return { kind: 'opaque', url: null };
}

/**
 * The URL when the caller's own string settled the host, and null when it did not. A
 * path's host belongs to whichever page the run is on, and that is not a fact the daemon
 * holds: scope is derived from where a run started and never learns where the tab went.
 * Standing something in for it here would let a host rule report a check it never made.
 */
export function hostBearingUrl(action: string, input: unknown): URL | null {
  const target = targetUrl(action, input);
  return target && (target.kind === 'absolute' || target.kind === 'authority') ? target.url : null;
}

/** Bytes a navigation would carry out of the browser in the query string or fragment. */
export function urlPayloadBytes(url: URL): number {
  return Buffer.byteLength(url.search) + Buffer.byteLength(url.hash);
}

/**
 * Whether an action would move the run off the tab it is pinned to. A bare
 * `page.switchTab` with no arguments only lists the open tabs, so it is not a move.
 */
export function targetsAnotherTab(action: string, input: unknown, scope: Scope): boolean {
  if (scope.tabId === undefined || !TAB_MOVES.has(action)) return false;
  const args = (input ?? {}) as { tabId?: unknown; match?: unknown };
  if (typeof args.tabId === 'number') {
    return args.tabId !== scope.tabId && !scope.ownedTabIds?.includes(args.tabId);
  }
  return typeof args.match === 'string' && args.match.length > 0;
}
