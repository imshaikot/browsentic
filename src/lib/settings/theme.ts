/**
 * The extension's four looks, named once for every side that sets one: the extension's own
 * settings page, the desktop app, and config.json, where the daemon keeps the choice so each
 * paired browser opens in the same one.
 */

export type ThemeId = 'ember' | 'midnight' | 'phosphor' | 'daylight';

export const THEMES: { id: ThemeId; name: string; note: string }[] = [
  { id: 'ember', name: 'Ember', note: 'Warm near-black, cyan brand.' },
  { id: 'midnight', name: 'Midnight', note: 'Cool blue-black, violet brand.' },
  { id: 'phosphor', name: 'Phosphor', note: 'A green CRT, grain turned up.' },
  { id: 'daylight', name: 'Daylight', note: 'Ink on paper, for a bright room.' },
];

export const DEFAULT_THEME: ThemeId = 'ember';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function asTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}
