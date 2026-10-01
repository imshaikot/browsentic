import { browser } from 'wxt/browser';
import { failure, type ActionResult } from '@/lib/actions/protocol';
import {
  BLOCKED_SITES_KEY,
  LIST_UNREADABLE_MESSAGE,
  SITE_BLOCKED,
  SITE_BLOCKED_MESSAGE,
  blockedBy,
  compileBlockedSites,
  subjectOf,
  type BlockedPattern,
} from '@/lib/settings/blocked-sites';
import { framePath } from './frame-focus';

type Url = string | undefined;

/** Read on every check: a worker that slept has no memory worth trusting, and the list can change at any moment. */
export async function readBlockedSites(): Promise<BlockedPattern[] | null> {
  try {
    return compileBlockedSites((await browser.storage.local.get(BLOCKED_SITES_KEY))[BLOCKED_SITES_KEY]);
  } catch {
    return null;
  }
}

/** One read, many checks — for walking every tab in a window. An unreadable list blocks every web page. */
export async function siteCheck(): Promise<(...urls: Url[]) => boolean> {
  const list = await readBlockedSites();
  return (...urls) => urls.some((url) => (list ? blockedBy(url, list) !== null : subjectOf(url) !== null));
}

export async function siteBlocked(...urls: Url[]): Promise<boolean> {
  return (await siteCheck())(...urls);
}

export async function refusalFor(...urls: Url[]): Promise<ActionResult<never> | null> {
  const list = await readBlockedSites();
  if (!list) return urls.some((url) => subjectOf(url) !== null) ? failure(SITE_BLOCKED, LIST_UNREADABLE_MESSAGE) : null;
  return urls.some((url) => blockedBy(url, list) !== null) ? blockedRefusal() : null;
}

/** The tab as it is right now — its address, where it is headed, and every frame on the focused path. */
export async function refusalForTab(tabId: number, ...also: Url[]): Promise<ActionResult<never> | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const frames = (await framePath(tabId)).map((step) => step.url);
  return refusalFor(...tabUrls(tab), ...frames, ...also);
}

export const blockedRefusal = (): ActionResult<never> => failure(SITE_BLOCKED, SITE_BLOCKED_MESSAGE);

export const isBlockedRefusal = (result: ActionResult): boolean => !result.ok && result.error.code === SITE_BLOCKED;

export const tabUrls = (tab: { url?: string; pendingUrl?: string } | null | undefined): Url[] => [tab?.url, tab?.pendingUrl];

export function onBlockedSitesChange(listener: () => void): void {
  browser.storage.local.onChanged.addListener((changes) => {
    if (BLOCKED_SITES_KEY in changes) listener();
  });
}
