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

interface Brand {
  brand: string;
  version?: string;
}

function productOf<T extends Brand>(brands: readonly T[]): T | undefined {
  const named = brands.filter(({ brand }) => !PLACEHOLDER_BRAND.test(brand));
  return named.find(({ brand }) => brand !== 'Chromium') ?? named[0];
}

export function brandFrom(brands: readonly Brand[]): string | undefined {
  return productOf(brands)?.brand;
}

export function releaseFrom(brands: readonly Brand[]): string | undefined {
  const product = productOf(brands);
  return product && [product.brand, product.version].filter(Boolean).join(' ');
}

const geckoRuntime = () =>
  browser.runtime as typeof browser.runtime & { getBrowserInfo(): Promise<{ name: string; version: string }> };

const chromiumBrands = (): Brand[] => (navigator as Navigator & { userAgentData?: { brands?: Brand[] } }).userAgentData?.brands ?? [];

async function browserName(): Promise<string | undefined> {
  try {
    if (import.meta.env.FIREFOX) return (await geckoRuntime().getBrowserInfo()).name;
    return brandFrom(chromiumBrands());
  } catch {
    return undefined;
  }
}

export async function browserRelease(): Promise<string | undefined> {
  try {
    if (import.meta.env.FIREFOX) {
      const { name, version } = await geckoRuntime().getBrowserInfo();
      return `${name} ${version}`;
    }
    return releaseFrom(chromiumBrands());
  } catch {
    return undefined;
  }
}
