import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { LINKS } from '@/lib/about';
import {
  STAR_NUDGE_KEY,
  UNASKED,
  asStarNudge,
  asksNow,
  noteFinishedTurn,
  noteStarred,
  openRepositoryBeside,
  withFinishedTurn,
  withStar,
  type StarNudge,
} from './star-nudge';

/** Plays turns finishing in each conversation in order, and lists the conversations that raised the ask. */
function askedAcross(start: StarNudge, conversations: string[]): string[] {
  const asked: string[] = [];
  conversations.reduce((nudge, conversation) => {
    const next = withFinishedTurn(nudge, conversation);
    if (asksNow(nudge, next)) asked.push(conversation);
    return next;
  }, start);
  return asked;
}

const afterTurnsIn = (...conversations: string[]): StarNudge => conversations.reduce(withFinishedTurn, UNASKED);

const stored = async () => (await fakeBrowser.storage.local.get(STAR_NUDGE_KEY))[STAR_NUDGE_KEY];

describe('when the star ask is raised', () => {
  it('asks after the very first turn that finishes', () => {
    expect(askedAcross(UNASKED, ['a'])).toEqual(['a']);
  });

  it('asks once in a conversation, however many turns finish there', () => {
    expect(askedAcross(UNASKED, ['a', 'a', 'a'])).toEqual(['a']);
  });

  it('asks again in the next conversation, then sits out two, then never again', () => {
    expect(askedAcross(UNASKED, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])).toEqual(['a', 'b', 'e']);
  });

  it('counts a conversation once while it waits, however many turns finish in it', () => {
    expect(askedAcross(UNASKED, ['a', 'b', 'c', 'c', 'd', 'd', 'e'])).toEqual(['a', 'b', 'e']);
  });

  it('never counts a conversation it already asked in while it waits', () => {
    expect(askedAcross(UNASKED, ['a', 'b', 'c', 'a', 'b', 'd', 'e'])).toEqual(['a', 'b', 'e']);
  });

  it('never asks again once the star was clicked', () => {
    expect(askedAcross(withStar(UNASKED), ['a', 'b', 'c'])).toEqual([]);
    expect(askedAcross(withStar(afterTurnsIn('a', 'b')), ['c', 'd', 'e', 'f', 'g'])).toEqual([]);
  });

  it('holds nothing more once it has asked for the last time', () => {
    expect(afterTurnsIn('a', 'b', 'c', 'd', 'e', 'f', 'g')).toEqual({ starred: false, askedIn: ['a', 'b', 'e'], finishedIn: [] });
  });
});

describe('the stored star ask', () => {
  beforeEach(() => fakeBrowser.reset());

  it('reads anything unexpected as never asked, keeping only the conversation ids it can read', () => {
    expect(asStarNudge(undefined)).toEqual(UNASKED);
    expect(asStarNudge('starred')).toEqual(UNASKED);
    expect(asStarNudge({ starred: 'yes', askedIn: 'a', finishedIn: ['a', 7] })).toEqual({ ...UNASKED, finishedIn: ['a'] });
  });

  it('records each ask and the star', async () => {
    expect(await noteFinishedTurn('a')).toBe(true);
    expect(await noteFinishedTurn('a')).toBe(false);
    expect(await stored()).toEqual({ starred: false, askedIn: ['a'], finishedIn: [] });

    await noteStarred();
    expect(await noteFinishedTurn('b')).toBe(false);
    expect(await stored()).toEqual({ starred: true, askedIn: ['a'], finishedIn: [] });
  });

  it('leaves storage alone when a turn changes nothing', async () => {
    await noteFinishedTurn('a');
    const write = vi.spyOn(fakeBrowser.storage.local, 'set');
    await noteFinishedTurn('a');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('opening the repository', () => {
  beforeEach(() => fakeBrowser.reset());

  it('opens it in a new tab right after the one in front', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 41, index: 3 }] as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await openRepositoryBeside();
    expect(create).toHaveBeenCalledWith({ url: LINKS.repository, index: 4, openerTabId: 41 });
  });

  it('still opens it when no tab is in front', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([]);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await openRepositoryBeside();
    expect(create).toHaveBeenCalledWith({ url: LINKS.repository, index: undefined, openerTabId: undefined });
  });
});
