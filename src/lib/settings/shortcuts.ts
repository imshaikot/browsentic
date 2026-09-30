export const PANEL_SHORTCUT = 'toggle-side-panel';
export const HANDS_FREE_SHORTCUT = 'toggle-hands-free';

const POPUP = 'Open the popup';
const PANEL = 'Open or close the side panel';
const HANDS_FREE = 'Start or stop hands-free';

interface ManifestCommand {
  description: string;
  suggested_key?: { default: string };
}

export function manifestCommands(firefox: boolean): Record<string, ManifestCommand> {
  if (firefox) {
    return {
      _execute_browser_action: { description: POPUP },
      _execute_sidebar_action: { description: PANEL, suggested_key: { default: 'Alt+Shift+B' } },
    };
  }
  return {
    _execute_action: { description: POPUP },
    [PANEL_SHORTCUT]: { description: PANEL, suggested_key: { default: 'Alt+Shift+B' } },
    [HANDS_FREE_SHORTCUT]: { description: HANDS_FREE, suggested_key: { default: 'Alt+Shift+H' } },
  };
}

const LABELS: Record<string, string> = {
  _execute_action: POPUP,
  _execute_browser_action: POPUP,
  [PANEL_SHORTCUT]: PANEL,
  _execute_sidebar_action: PANEL,
  [HANDS_FREE_SHORTCUT]: HANDS_FREE,
};

const ORDER = Object.keys(LABELS);

export interface Shortcut {
  name: string;
  label: string;
  keys: string[];
}

export function shortcutsOf(commands: readonly { name?: string; description?: string; shortcut?: string }[]): Shortcut[] {
  return commands
    .flatMap(({ name, description, shortcut }) =>
      name ? [{ name, label: LABELS[name] ?? description ?? name, keys: keysOf(shortcut ?? '') }] : [],
    )
    .sort((a, b) => rank(a.name) - rank(b.name));
}

const rank = (name: string): number => {
  const index = ORDER.indexOf(name);
  return index === -1 ? ORDER.length : index;
};

/** Chromium on a Mac answers `⌥⇧B`; everywhere else it is `Alt+Shift+B`. */
export function keysOf(shortcut: string): string[] {
  if (!shortcut) return [];
  if (shortcut.includes('+')) return shortcut.split('+');
  const [, modifiers = '', key = ''] = /^([⌃⌥⇧⌘]*)(.*)$/u.exec(shortcut) ?? [];
  return [...modifiers, ...(key ? [key] : [])];
}

export const shortcutsPageFor = (brand: string | undefined): string =>
  brand === 'Microsoft Edge' ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
