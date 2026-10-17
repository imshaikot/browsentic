import { browser } from 'wxt/browser';
import type { VisitedSite } from '@/lib/home/frequent-sites';

const TOP_SITES = { permissions: ['topSites' as const] };

const FIREFOX_TOP_SITES = { includeFavicon: true, onePerDomain: true, newtab: true, limit: 24 };

type GeckoTopSites = { get: (options: typeof FIREFOX_TOP_SITES) => Promise<VisitedSite[]> };

/** Chrome grants this with the extension. Firefox asks for it from a click, so an update never waits on a new permission. */
export const canReadTopSites = (): Promise<boolean> => browser.permissions.contains(TOP_SITES);

export const askForTopSites = (): Promise<boolean> => browser.permissions.request(TOP_SITES);

/** The icon the browser keeps for a page, read through Chromium's favicon service; Firefox has none to ask. */
export function faviconOf(pageUrl: string | undefined, size = 32): string | undefined {
  if (import.meta.env.FIREFOX || !pageUrl) return undefined;
  return `${browser.runtime.getURL('/')}_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

export async function readTopSites(): Promise<VisitedSite[]> {
  if (import.meta.env.FIREFOX) return (browser.topSites as unknown as GeckoTopSites).get(FIREFOX_TOP_SITES);
  return (await browser.topSites.get()).map(({ url, title }) => ({ url, title, favicon: faviconOf(url, 64) }));
}
