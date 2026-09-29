import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { shortcutsOf, shortcutsPageFor, type Shortcut } from '@/lib/settings/shortcuts';
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

/** Read again whenever this page comes back into view, since the keys are changed on the browser's own page. */
export function useShortcuts(): Shortcut[] | null {
  const [shortcuts, setShortcuts] = useState<Shortcut[] | null>(null);

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
