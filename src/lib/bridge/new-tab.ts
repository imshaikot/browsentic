import { browser } from 'wxt/browser';
import { NEW_TAB_KEY, asNewTabChoice, browserNewTabPage, type NewTabChoice } from '@/lib/settings/new-tab';
import { brandFrom } from './identity';

/* storage.local answers after the first frame, so a tab with Home switched off would flash it
   before handing itself on. The switch is mirrored here, where a page can read it at once. */
const PAINT_HINT = 'browsentic/newTab.paint';

export async function readNewTabChoice(): Promise<NewTabChoice> {
  return asNewTabChoice((await browser.storage.local.get(NEW_TAB_KEY))[NEW_TAB_KEY]);
}

export function rememberHome(home: boolean): void {
  localStorage.setItem(PAINT_HINT, home ? 'on' : 'off');
}

export const homeLooksOff = (): boolean => localStorage.getItem(PAINT_HINT) === 'off';

type Brand = { brand: string };

export function browserOwnNewTab(): string | null {
  if (import.meta.env.FIREFOX) return null;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Brand[] } }).userAgentData?.brands ?? [];
  return browserNewTabPage(brandFrom(brands));
}

/** Only the tabs API may open a browser page; the page itself is refused a `chrome://` address. */
export async function handTabTo(url: string): Promise<boolean> {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id == null) return false;
  await browser.tabs.update(tab.id, { url });
  return true;
}
