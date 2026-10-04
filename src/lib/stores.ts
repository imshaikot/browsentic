/** Where each browser gets the extension, and how the daemon tells which copy a browser runs. */

export const CHROME_WEB_STORE = {
  id: 'npmocgldfflonjjmdadmdefpnfagnjmp',
  url: 'https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp',
} as const;

/**
 * Microsoft gives the listing its address only once it is published. Until then Edge is sent to the
 * Chrome Web Store, which it installs from once "Allow extensions from other stores" is on, and the
 * copy it installs carries the Chrome Web Store's ID.
 */
export const EDGE_ADD_ONS: { id: string; url: string | null } = {
  id: 'cbkjhkgjcpihokphhdkbahilpcjojpdc',
  url: null,
};

/** Signed by addons.mozilla.org for every release and installed from the GitHub release. */
export const FIREFOX_ADDON_ID = 'browsentic@browsentic.com';

export const STORE_EXTENSION_IDS = [CHROME_WEB_STORE.id, EDGE_ADD_ONS.id];

export type Source = 'chrome-web-store' | 'edge-add-ons' | 'firefox' | 'unpacked';

export const SOURCE_LABEL: Record<Source, string> = {
  'chrome-web-store': 'Chrome Web Store',
  'edge-add-ons': 'Edge Add-ons',
  firefox: 'Firefox add-on',
  unpacked: 'unpacked',
};

/** A Chromium extension the stores did not sign is one somebody loaded from a folder. */
export function sourceOf(origin: string): Source {
  if (origin.startsWith('moz-extension://')) return 'firefox';
  const id = origin.replace(/^chrome-extension:\/\//, '').replace(/\/$/, '');
  if (id === CHROME_WEB_STORE.id) return 'chrome-web-store';
  if (id === EDGE_ADD_ONS.id) return 'edge-add-ons';
  return 'unpacked';
}
