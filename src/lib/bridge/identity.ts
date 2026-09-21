import { browser } from 'wxt/browser';

const INSTALL_ID_STORE = 'browsentic/installId';

const PLACEHOLDER_BRAND = /not.?a.?brand/i;

export interface Identity {
  installId: string;
  browser?: string;
}

let identity: Promise<Identity> | undefined;

/**
 * Kept apart from the session key so unpairing does not mint a new browser: pairing again then
 * replaces this browser's old session instead of leaving it behind as one that never returns.
 */
export function identify(): Promise<Identity> {
  return (identity ??= Promise.all([installId(), browserName()]).then(([id, name]) => ({
    installId: id,
    browser: name,
  })));
}

async function installId(): Promise<string> {
  const stored = (await browser.storage.local.get(INSTALL_ID_STORE))[INSTALL_ID_STORE];
  if (typeof stored === 'string' && stored) return stored;
  const minted = crypto.randomUUID();
  await browser.storage.local.set({ [INSTALL_ID_STORE]: minted });
  return minted;
}

export function brandFrom(brands: readonly { brand: string }[]): string | undefined {
  const named = brands.map(({ brand }) => brand).filter((brand) => !PLACEHOLDER_BRAND.test(brand));
  return named.find((brand) => brand !== 'Chromium') ?? named[0];
}

async function browserName(): Promise<string | undefined> {
  try {
    if (import.meta.env.FIREFOX) {
      const gecko = browser.runtime as typeof browser.runtime & { getBrowserInfo(): Promise<{ name: string }> };
      return (await gecko.getBrowserInfo()).name;
    }
    const agent = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
    return brandFrom(agent.userAgentData?.brands ?? []);
  } catch {
    return undefined;
  }
}
