import { browser } from 'wxt/browser';
import type { Preferences } from '@/lib/settings/preferences';
import { asTheme, type ThemeId } from '@/lib/settings/theme';
import { DAEMON_STATE_KEY, onPreferences, setPreference, type DaemonState } from './socket';
import { THEME_KEY, readChosenTheme } from './theme';

/** Set while this browser holds a theme the daemon has not been told, because it could not be reached. */
export const THEME_UNSYNCED_KEY = 'browsentic/theme.unsynced';

/**
 * Keeps this browser's theme and config.json's in step. What the daemon pushes wins, except
 * over a pick made here that it has not heard yet — made while it was unreachable, or before
 * this browser was ever paired — which is handed over at the next connect instead.
 */
export function servePreferences(): void {
  onPreferences((preferences) => void adopt(preferences));
  browser.storage.local.onChanged.addListener((changes) => {
    if (THEME_KEY in changes) void forward(asTheme(changes[THEME_KEY].newValue));
  });
}

async function adopt({ theme }: Preferences): Promise<void> {
  const [chosen, unsynced] = await Promise.all([readChosenTheme(), readUnsynced()]);
  if (chosen && chosen !== theme && (unsynced || theme === null)) return hand(chosen);
  if (unsynced) await browser.storage.local.remove(THEME_UNSYNCED_KEY);
  if (theme && theme !== chosen) await browser.storage.local.set({ [THEME_KEY]: theme });
}

async function forward(theme: ThemeId): Promise<void> {
  const stored = await browser.storage.session.get(DAEMON_STATE_KEY);
  if ((stored[DAEMON_STATE_KEY] as DaemonState | undefined)?.preferences?.theme === theme) return;
  await hand(theme);
}

async function hand(theme: ThemeId): Promise<void> {
  const result = await setPreference({ kind: 'theme', theme });
  if (result.ok) await browser.storage.local.remove(THEME_UNSYNCED_KEY);
  else await browser.storage.local.set({ [THEME_UNSYNCED_KEY]: true });
}

async function readUnsynced(): Promise<boolean> {
  return (await browser.storage.local.get(THEME_UNSYNCED_KEY))[THEME_UNSYNCED_KEY] === true;
}
