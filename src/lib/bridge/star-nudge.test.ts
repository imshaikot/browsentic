import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { LINKS } from '@/lib/about';
import {
  STAR_NUDGE_KEY,
  UNASKED,
  asStarNudge,
  isDue,
  noteClosed,
  noteFinishedTurn,
  noteStarred,
  openRepositoryBeside,
  withClose,
  withFinishedTurn,
  withStar,
  type StarNudge,
} from './star-nudge';

/** Plays turns finishing in each conversation in order, and lists the conversations that raised the ask. */
function raisedAcross(start: StarNudge, conversations: string[]): string[] {
  const raised: string[] = [];
  conversations.reduce((nudge, conversation) => {
    const next = withFinishedTurn(nudge, conversation);
    if (isDue(next, conversation)) raised.push(conversation);
    return next;
  }, start);
  return raised;
}

const afterClosing = (...conversations: string[]): StarNudge => conversations.reduce(withClose, UNASKED);

const stored = async () => (await fakeBrowser.storage.local.get(STAR_NUDGE_KEY))[STAR_NUDGE_KEY];

describe('when the star ask is raised', () => {
  it('asks after the very first turn that finishes', () => {
    expect(raisedAcross(UNASKED, ['a'])).toEqual(['a']);
  });

  it('never asks again once the star was clicked', () => {
    expect(raisedAcross(withStar(UNASKED), ['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([]);
    expect(raisedAcross(withStar(afterClosing('a', 'b', 'c')), ['d', 'e', 'f', 'g', 'h'])).toEqual([]);
  });

  it('after a first close, sits out the rest of that conversation and asks in the next', () => {
    expect(raisedAcross(afterClosing('a'), ['a', 'a', 'b'])).toEqual(['b']);
  });

  it('after a second close, sits out two conversations and asks in the third', () => {
    expect(raisedAcross(afterClosing('a', 'b'), ['b', 'c', 'd', 'e'])).toEqual(['e']);
  });

  it('after a third close and every one after it, sits out three conversations', () => {
    expect(raisedAcross(afterClosing('a', 'b', 'c'), ['d', 'e', 'f', 'g'])).toEqual(['g']);
    expect(raisedAcross(afterClosing('a', 'b', 'c', 'g'), ['h', 'i', 'j', 'k'])).toEqual(['k']);
  });

  it('counts a conversation once, however many turns finish in it', () => {
    expect(raisedAcross(afterClosing('a', 'b'), ['c', 'c', 'c', 'd', 'd', 'e'])).toEqual(['e']);
  });

  it('never asks again in a conversation where it was closed, nor counts it', () => {
    expect(raisedAcross(afterClosing('a', 'b'), ['c', 'd', 'a', 'e'])).toEqual(['e']);
  });

  it('takes a second close in the same conversation as the first', () => {
    const closed = afterClosing('a');
    expect(withClose(closed, 'a')).toBe(closed);
  });

  it('keeps a star through a close that lands after it', () => {
    expect(withClose(withStar(UNASKED), 'a').starred).toBe(true);
  });

  it('keeps asking in any new conversation until it is answered, holding no more than it needs', () => {
    const ignored = ['b', 'c', 'd', 'e', 'f'].reduce(withFinishedTurn, afterClosing('a', 'b'));
    expect(ignored.finishedIn).toEqual(['c', 'd', 'e']);
    expect(isDue(withFinishedTurn(ignored, 'z'), 'z')).toBe(true);
  });
});

describe('the stored star ask', () => {
  beforeEach(() => fakeBrowser.reset());

  it('reads anything unexpected as never asked, keeping only the conversation ids it can read', () => {
    expect(asStarNudge(undefined)).toEqual(UNASKED);
    expect(asStarNudge('starred')).toEqual(UNASKED);
    expect(asStarNudge({ starred: 'yes', closes: -2, closedIn: 'a', finishedIn: ['a', 7] })).toEqual({
      ...UNASKED,
      finishedIn: ['a'],
    });
  });

  it('records each finished turn, each close and the star', async () => {
    expect(isDue(await noteFinishedTurn('a'), 'a')).toBe(true);
    expect(await stored()).toEqual({ starred: false, closes: 0, closedIn: [], finishedIn: ['a'] });

    await noteClosed('a');
    expect(isDue(await noteFinishedTurn('a'), 'a')).toBe(false);
    expect(isDue(await noteFinishedTurn('b'), 'b')).toBe(true);

    await noteStarred();
    expect(isDue(await noteFinishedTurn('c'), 'c')).toBe(false);
    expect(await stored()).toMatchObject({ starred: true, closes: 1, closedIn: ['a'] });
  });

  it('leaves storage alone when a turn changes nothing', async () => {
    await noteStarred();
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
