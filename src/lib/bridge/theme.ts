import { browser } from 'wxt/browser';

export type ThemeId = 'ember' | 'midnight' | 'phosphor' | 'daylight';

export const THEMES: { id: ThemeId; name: string; note: string }[] = [
  { id: 'ember', name: 'Ember', note: 'Warm near-black, cyan brand.' },
  { id: 'midnight', name: 'Midnight', note: 'Cool blue-black, violet brand.' },
  { id: 'phosphor', name: 'Phosphor', note: 'A green CRT, grain turned up.' },
  { id: 'daylight', name: 'Daylight', note: 'Ink on paper, for a bright room.' },
];

export const DEFAULT_THEME: ThemeId = 'ember';
export const THEME_KEY = 'browsentic/theme';

/* storage.local answers a tick after the page has already painted, which on a
   light theme is a dark flash every time the popup opens. The chosen id is
   mirrored here — the one store a document can read before its first frame —
   and storage.local stays the truth that corrects it. */
const PAINT_HINT = 'browsentic/theme.paint';

export function asTheme(value: unknown): ThemeId {
  return THEMES.some((theme) => theme.id === value) ? (value as ThemeId) : DEFAULT_THEME;
}

/* index.html paints an inline ground so the frame before the stylesheet is not
   white; an inline colour outranks every rule, so hand it back to the sheet. */
export async function readTheme(): Promise<ThemeId> {
  return asTheme((await browser.storage.local.get(THEME_KEY))[THEME_KEY]);
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.backgroundColor = '';
  localStorage.setItem(PAINT_HINT, theme);
}

export async function writeTheme(theme: ThemeId) {
  applyTheme(theme);
  await browser.storage.local.set({ [THEME_KEY]: theme });
}

export function mountTheme() {
  applyTheme(asTheme(localStorage.getItem(PAINT_HINT)));

  void readTheme().then(applyTheme);

  browser.storage.local.onChanged.addListener((changes) => {
    if (THEME_KEY in changes) applyTheme(asTheme(changes[THEME_KEY].newValue));
  });
}
