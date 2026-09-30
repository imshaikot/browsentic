import { describe, expect, it } from 'vitest';
import { HANDS_FREE_SHORTCUT, PANEL_SHORTCUT, keysOf, manifestCommands, shortcutsOf, shortcutsPageFor } from './shortcuts';

describe('manifestCommands', () => {
  it('gives Chromium the popup, the panel and hands-free', () => {
    expect(Object.keys(manifestCommands(false))).toEqual(['_execute_action', PANEL_SHORTCUT, HANDS_FREE_SHORTCUT]);
  });

  it('gives Firefox its own popup and sidebar names, and no hands-free', () => {
    expect(Object.keys(manifestCommands(true))).toEqual(['_execute_browser_action', '_execute_sidebar_action']);
  });
});

describe('keysOf', () => {
  it('splits the Windows and Linux form on +', () => {
    expect(keysOf('Alt+Shift+B')).toEqual(['Alt', 'Shift', 'B']);
  });

  it('splits the Mac symbols one modifier at a time, keeping a named key whole', () => {
    expect(keysOf('⌥⇧B')).toEqual(['⌥', '⇧', 'B']);
    expect(keysOf('⌃⇧Space')).toEqual(['⌃', '⇧', 'Space']);
  });

  it('has no keys for a shortcut nobody set', () => {
    expect(keysOf('')).toEqual([]);
  });
});

describe('shortcutsOf', () => {
  it('orders popup, panel, hands-free and names each the same everywhere', () => {
    const shortcuts = shortcutsOf([
      { name: HANDS_FREE_SHORTCUT, description: 'Start or stop hands-free', shortcut: '' },
      { name: PANEL_SHORTCUT, description: 'Open or close the side panel', shortcut: 'Alt+Shift+B' },
      { name: '_execute_action', description: '', shortcut: '' },
    ]);
    expect(shortcuts.map(({ label }) => label)).toEqual([
      'Open the popup',
      'Open or close the side panel',
      'Start or stop hands-free',
    ]);
    expect(shortcuts[1].keys).toEqual(['Alt', 'Shift', 'B']);
  });

  it('keeps a command it does not know, by its own description, at the end', () => {
    const shortcuts = shortcutsOf([
      { name: 'something-new', description: 'Do something new' },
      { name: PANEL_SHORTCUT, shortcut: '' },
    ]);
    expect(shortcuts.map(({ label }) => label)).toEqual(['Open or close the side panel', 'Do something new']);
  });
});

describe('shortcutsPageFor', () => {
  it('sends Edge to its own scheme and every other Chromium to chrome://', () => {
    expect(shortcutsPageFor('Microsoft Edge')).toBe('edge://extensions/shortcuts');
    expect(shortcutsPageFor('Google Chrome')).toBe('chrome://extensions/shortcuts');
    expect(shortcutsPageFor(undefined)).toBe('chrome://extensions/shortcuts');
  });
});
