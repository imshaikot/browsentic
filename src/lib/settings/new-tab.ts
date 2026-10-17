/**
 * Browsentic Home, the page a new tab opens on. A browser takes a new tab page from the manifest
 * alone, so switching Home off cannot give the slot back: the page hands each tab on instead, to
 * the browser's own page where an extension can open it, or to a quiet page of frequent sites.
 */

export const NEW_TAB_KEY = 'browsentic/newTab';

export const MAX_HIDDEN_SITES = 100;

export interface NewTabChoice {
  home: boolean;
  sites: boolean;
  /** Hosts the user took off the frequent sites row. */
  hidden: string[];
}

export function asNewTabChoice(value: unknown): NewTabChoice {
  const stored = (value !== null && typeof value === 'object' ? value : {}) as Partial<Record<keyof NewTabChoice, unknown>>;
  const hidden = Array.isArray(stored.hidden) ? stored.hidden.filter((host): host is string => typeof host === 'string') : [];
  return { home: stored.home !== false, sites: stored.sites !== false, hidden: hidden.slice(-MAX_HIDDEN_SITES) };
}

export const hideSite = (choice: NewTabChoice, host: string): NewTabChoice => ({
  ...choice,
  hidden: [...choice.hidden.filter((kept) => kept !== host), host].slice(-MAX_HIDDEN_SITES),
});

/** Google Chrome keeps its own new tab page at an address an extension may open; Edge, Brave and Firefox do not. */
export function browserNewTabPage(brand: string | undefined): string | null {
  return brand === 'Google Chrome' ? 'chrome://new-tab-page/' : null;
}
