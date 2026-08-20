/**
 * A run's blast radius: the hosts it may reach and the tab it may drive.
 *
 * Scope is derived once, when a run starts, from things the user controls — the tab
 * they were on, the words they typed, their config. It never widens on its own, and
 * nothing read from a page can widen it. That is the whole point: an injected
 * instruction can still be obeyed, but it has nowhere to send what it stole.
 */

const NAVIGATIONS = new Set(['page.navigate', 'page.openTab']);
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

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * The absolute URL an action would open, or null when there is none to judge.
 * A relative URL resolves against the tab the run is already on, so it cannot
 * change host and is not a navigation decision worth gating.
 */
export function targetUrl(action: string, input: unknown): URL | null {
  if (!NAVIGATIONS.has(action)) return null;
  const url = (input as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
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
