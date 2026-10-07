import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { BLOCKED_SITES_KEY, blockedBy, compileBlockedSites } from '@/lib/settings/blocked-sites';
import { shortcutsOf, shortcutsPageFor, type Shortcut } from '@/lib/settings/shortcuts';
import { ACTION_CUES_KEY, actionCuesOn } from './action-cues';
import { CONTEXT_MENU_KEY, asContextMenuChoice, type ContextMenuChoice } from './context-menu';
import { brandFrom } from './identity';
import { PUSH_TO_TALK_KEY } from './panel-view';

function useLocalSetting<T>(key: string, parse: (value: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => parse(undefined));

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(key).then((stored) => {
      if (live) setValue(parse(stored[key]));
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (key in changes) setValue(parse(changes[key].newValue));
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, [key, parse]);

  const write = useCallback(
    (next: T) => {
      setValue(next);
      void browser.storage.local.set({ [key]: next });
    },
    [key],
  );

  return [value, write];
}

const isOn = (value: unknown): boolean => value === true;

export const useContextMenuChoice = (): [ContextMenuChoice, (next: ContextMenuChoice) => void] =>
  useLocalSetting(CONTEXT_MENU_KEY, asContextMenuChoice);

export const usePushToTalk = (): [boolean, (on: boolean) => void] => useLocalSetting(PUSH_TO_TALK_KEY, isOn);

export const useActionCues = (): [boolean, (on: boolean) => void] => useLocalSetting(ACTION_CUES_KEY, actionCuesOn);

const asPatterns = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** The one writer of the blocked-sites list. Nothing on the daemon's side of the socket can reach this key. */
export const useBlockedSites = (): [string[], (next: string[]) => void] => useLocalSetting(BLOCKED_SITES_KEY, asPatterns);

export function useBlockedPattern(url: string | undefined): string | null {
  const [patterns] = useBlockedSites();
  return useMemo(() => blockedBy(url, compileBlockedSites(patterns) ?? []), [url, patterns]);
}

export function openBlockedSites(): void {
  void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#blocked` });
}

export function useShortcuts(): Shortcut[] | undefined {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>();

  useEffect(() => {
    let live = true;
    const read = () =>
      void browser.commands
        .getAll()
        .then((commands) => live && setShortcuts(shortcutsOf(commands)))
        .catch(() => live && setShortcuts([]));
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  return shortcuts;
}

export function openShortcutSettings(): void {
  if (import.meta.env.FIREFOX) {
    void (browser.commands as unknown as { openShortcutSettings: () => Promise<void> }).openShortcutSettings();
    return;
  }
  const agent = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  void browser.tabs.create({ url: shortcutsPageFor(brandFrom(agent.userAgentData?.brands ?? [])) });
}
