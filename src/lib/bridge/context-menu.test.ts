import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { CONTEXT_MENU_KEY, HANDS_FREE_ITEM, PANEL_ITEM, asContextMenuChoice, describeMenu, readContextMenuChoice } from './context-menu';

const both = { panel: true, handsFree: true };
const idle = { choice: both, speech: true, panelOpen: false, handsFree: false };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('describeMenu', () => {
  it('offers the panel and hands-free where speech works', () => {
    expect(describeMenu(idle)).toEqual([
      { id: PANEL_ITEM, title: 'Open Browsentic' },
      { id: HANDS_FREE_ITEM, title: 'Open Browsentic (Hands Free)' },
    ]);
  });

  it('never offers hands-free where speech cannot work, whatever the choice', () => {
    expect(describeMenu({ ...idle, speech: false }).map(({ id }) => id)).toEqual([PANEL_ITEM]);
  });

  it('offers to close whichever surface is showing', () => {
    expect(describeMenu({ ...idle, panelOpen: true })[0].title).toBe('Close Browsentic');
    expect(describeMenu({ ...idle, handsFree: true })[1].title).toBe('Close Browsentic (Hands Free)');
  });

  it('leaves out what was switched off, down to an empty menu', () => {
    expect(describeMenu({ ...idle, choice: { panel: false, handsFree: true } }).map(({ id }) => id)).toEqual([HANDS_FREE_ITEM]);
    expect(describeMenu({ ...idle, choice: { panel: false, handsFree: false } })).toEqual([]);
  });
});

describe('the stored choice', () => {
  it('has both items on until one is switched off', async () => {
    expect(await readContextMenuChoice()).toEqual(both);
    await fakeBrowser.storage.local.set({ [CONTEXT_MENU_KEY]: { panel: false } });
    expect(await readContextMenuChoice()).toEqual({ panel: false, handsFree: true });
  });

  it('reads anything malformed as the default', () => {
    expect(asContextMenuChoice('off')).toEqual(both);
    expect(asContextMenuChoice(null)).toEqual(both);
    expect(asContextMenuChoice({ panel: 0, handsFree: 'no' })).toEqual(both);
  });
});
