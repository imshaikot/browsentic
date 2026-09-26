import { browser } from 'wxt/browser';
import { recognitionCtor } from './recognition';

export const SPEECH_SERVICE_KEY = 'browsentic/speechService';

/** What the speech service itself has shown: it transcribed something, or it failed before it ever had. */
export type SpeechService = 'works' | 'missing';

/** Chromium forks that ship the recognizer without the service it talks to, so every attempt fails with `network`. */
const SERVICELESS_BRANDS = ['Brave'];

type Brands = { brand: string }[];

export interface SpeechPlatform {
  /** An offscreen document to listen from once the panel is closed. */
  offscreen: boolean;
  /** A recognizer to listen with. Unknowable from the service worker, which has no window. */
  recognizer: boolean;
  brands: Brands;
}

export const capableOf = ({ offscreen, recognizer, brands }: SpeechPlatform): boolean =>
  offscreen && recognizer && !brands.some(({ brand }) => SERVICELESS_BRANDS.includes(brand));

/**
 * Whether hands-free mode can exist here, from what is knowable without listening. Firefox has
 * no offscreen document to listen from and no recognizer to listen with; some Chromium forks
 * have the recognizer and nothing behind it. A fork not named here is settled by the service
 * itself, through `noteSpeechService`.
 */
export function speechCapable(): boolean {
  if (import.meta.env.FIREFOX) return false;
  const offscreen = (browser as unknown as { offscreen?: { createDocument?: unknown } }).offscreen;
  return capableOf({
    offscreen: typeof offscreen?.createDocument === 'function',
    recognizer: typeof window === 'undefined' || recognitionCtor() !== null,
    brands: brandsOfThisBrowser(),
  });
}

function brandsOfThisBrowser(): Brands {
  const agent = navigator as Navigator & { userAgentData?: { brands?: Brands } };
  return agent.userAgentData?.brands ?? [];
}

export async function readSpeechService(): Promise<SpeechService | null> {
  const stored = (await browser.storage.local.get(SPEECH_SERVICE_KEY))[SPEECH_SERVICE_KEY];
  return stored === 'works' || stored === 'missing' ? stored : null;
}

/**
 * Records what the service just did, and answers what is now believed. `works` always wins: a
 * service that has transcribed once and then fails is out of reach for a moment, not missing.
 */
export async function noteSpeechService(outcome: SpeechService): Promise<SpeechService> {
  const known = await readSpeechService();
  if (known === 'works' || known === outcome) return known;
  await browser.storage.local.set({ [SPEECH_SERVICE_KEY]: outcome });
  return outcome;
}

export function handsFreeAllowed(service: SpeechService | null, capable = speechCapable()): boolean {
  return capable && service !== 'missing';
}

export async function handsFreeSupported(): Promise<boolean> {
  return handsFreeAllowed(await readSpeechService());
}
