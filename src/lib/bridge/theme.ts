import { browser } from 'wxt/browser';
import { asTheme, isThemeId, type ThemeId } from '@/lib/settings/theme';

export { THEMES, DEFAULT_THEME, asTheme, type ThemeId } from '@/lib/settings/theme';

export const THEME_KEY = 'browsentic/theme';

/* storage.local answers a tick after the page has already painted, which on a
   light theme is a dark flash every time the popup opens. The chosen id is
   mirrored here — the one store a document can read before its first frame —
   and storage.local stays the truth that corrects it. */
const PAINT_HINT = 'browsentic/theme.paint';

export async function readTheme(): Promise<ThemeId> {
  return asTheme(await readChosenTheme());
}

/** Null until someone picks one, so a first pairing can tell a choice from the default. */
export async function readChosenTheme(): Promise<ThemeId | null> {
  const stored = (await browser.storage.local.get(THEME_KEY))[THEME_KEY];
  return isThemeId(stored) ? stored : null;
}

/* Clearing the inline colour hands the ground back to the stylesheet: index.html
   paints one so the frame before the sheet lands is not white, and an inline
   colour outranks every rule that would later repaint it. */
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
