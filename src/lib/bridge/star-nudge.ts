import { browser } from 'wxt/browser';
import { LINKS } from '@/lib/about';

export const STAR_NUDGE_KEY = 'browsentic/starNudge';

const CONVERSATIONS_SKIPPED_BY_CLOSES = [0, 0, 2, 3];

export interface StarNudge {
  starred: boolean;
  closes: number;
  closedIn: string[];
  finishedIn: string[];
}

export const UNASKED: StarNudge = { starred: false, closes: 0, closedIn: [], finishedIn: [] };

const isText = (value: unknown): value is string => typeof value === 'string';

const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isText) : []);

export function asStarNudge(value: unknown): StarNudge {
  if (typeof value !== 'object' || value === null) return UNASKED;
  const held = value as Partial<Record<keyof StarNudge, unknown>>;
  return {
    starred: held.starred === true,
    closes: typeof held.closes === 'number' && held.closes > 0 ? Math.floor(held.closes) : 0,
    closedIn: texts(held.closedIn),
    finishedIn: texts(held.finishedIn),
  };
}

export const conversationsSkipped = (closes: number): number =>
  CONVERSATIONS_SKIPPED_BY_CLOSES[Math.min(closes, CONVERSATIONS_SKIPPED_BY_CLOSES.length - 1)];

const waitedOut = (nudge: StarNudge): boolean => nudge.finishedIn.length > conversationsSkipped(nudge.closes);

export const isDue = (nudge: StarNudge, sessionId: string): boolean =>
  !nudge.starred && !nudge.closedIn.includes(sessionId) && waitedOut(nudge);

export function withFinishedTurn(nudge: StarNudge, sessionId: string): StarNudge {
  const uncounted =
    !nudge.starred &&
    !nudge.closedIn.includes(sessionId) &&
    !nudge.finishedIn.includes(sessionId) &&
    !waitedOut(nudge);
  return uncounted ? { ...nudge, finishedIn: [...nudge.finishedIn, sessionId] } : nudge;
}

export function withClose(nudge: StarNudge, sessionId: string): StarNudge {
  if (nudge.closedIn.includes(sessionId)) return nudge;
  return {
    starred: nudge.starred,
    closes: nudge.closes + 1,
    closedIn: [...nudge.closedIn, sessionId],
    finishedIn: [],
  };
}

export const withStar = (nudge: StarNudge): StarNudge => ({ ...nudge, starred: true });

async function update(change: (nudge: StarNudge) => StarNudge): Promise<StarNudge> {
  const stored = await browser.storage.local.get(STAR_NUDGE_KEY);
  const current = asStarNudge(stored[STAR_NUDGE_KEY]);
  const next = change(current);
  if (next !== current) await browser.storage.local.set({ [STAR_NUDGE_KEY]: next });
  return next;
}

export const noteFinishedTurn = (sessionId: string): Promise<StarNudge> =>
  update((nudge) => withFinishedTurn(nudge, sessionId));

export const noteClosed = (sessionId: string): Promise<StarNudge> => update((nudge) => withClose(nudge, sessionId));

export const noteStarred = (): Promise<StarNudge> => update(withStar);

export async function openRepositoryBeside(): Promise<void> {
  const [current] = await browser.tabs.query({ active: true, currentWindow: true });
  await browser.tabs.create({
    url: LINKS.repository,
    index: current ? current.index + 1 : undefined,
    openerTabId: current?.id,
  });
}
