import { browser } from 'wxt/browser';
import { LINKS } from '@/lib/about';

export const STAR_NUDGE_KEY = 'browsentic/starNudge';

const CONVERSATIONS_SKIPPED_BEFORE_ASK = [0, 0, 2];

export interface StarNudge {
  starred: boolean;
  askedIn: string[];
  finishedIn: string[];
}

export const UNASKED: StarNudge = { starred: false, askedIn: [], finishedIn: [] };

const isText = (value: unknown): value is string => typeof value === 'string';

const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isText) : []);

export function asStarNudge(value: unknown): StarNudge {
  if (typeof value !== 'object' || value === null) return UNASKED;
  const held = value as Partial<Record<keyof StarNudge, unknown>>;
  return {
    starred: held.starred === true,
    askedIn: texts(held.askedIn),
    finishedIn: texts(held.finishedIn),
  };
}

const retired = (nudge: StarNudge): boolean =>
  nudge.starred || nudge.askedIn.length >= CONVERSATIONS_SKIPPED_BEFORE_ASK.length;

const waitedOut = (nudge: StarNudge): boolean =>
  nudge.finishedIn.length > CONVERSATIONS_SKIPPED_BEFORE_ASK[nudge.askedIn.length];

export function withFinishedTurn(nudge: StarNudge, sessionId: string): StarNudge {
  if (retired(nudge) || nudge.askedIn.includes(sessionId) || nudge.finishedIn.includes(sessionId)) return nudge;
  const counted = { ...nudge, finishedIn: [...nudge.finishedIn, sessionId] };
  return waitedOut(counted) ? { ...nudge, askedIn: [...nudge.askedIn, sessionId], finishedIn: [] } : counted;
}

export const asksNow = (before: StarNudge, after: StarNudge): boolean => after.askedIn.length > before.askedIn.length;

export const withStar = (nudge: StarNudge): StarNudge => ({ ...nudge, starred: true });

async function update(change: (nudge: StarNudge) => StarNudge): Promise<[StarNudge, StarNudge]> {
  const stored = await browser.storage.local.get(STAR_NUDGE_KEY);
  const current = asStarNudge(stored[STAR_NUDGE_KEY]);
  const next = change(current);
  if (next !== current) await browser.storage.local.set({ [STAR_NUDGE_KEY]: next });
  return [current, next];
}

export async function noteFinishedTurn(sessionId: string): Promise<boolean> {
  const [before, after] = await update((nudge) => withFinishedTurn(nudge, sessionId));
  return asksNow(before, after);
}

export async function noteStarred(): Promise<void> {
  await update(withStar);
}

export async function openRepositoryBeside(): Promise<void> {
  const [current] = await browser.tabs.query({ active: true, currentWindow: true });
  await browser.tabs.create({
    url: LINKS.repository,
    index: current ? current.index + 1 : undefined,
    openerTabId: current?.id,
  });
}
