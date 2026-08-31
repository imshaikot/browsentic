export const RAIL_CHANNEL = 'browsentic/rail';

export type PanelTab = 'chat' | 'history' | 'skills' | 'recordings' | 'settings';

export type RailTone = 'off' | 'pending' | 'live' | 'busy' | 'listening' | 'warn';

export interface RailView {
  tab: PanelTab;
  side: 'left' | 'right';
  running: number;
  tone: RailTone;
  status: string;
  counts: Partial<Record<PanelTab, number>>;
}

export type RailCommand =
  | { channel: typeof RAIL_CHANNEL; op: 'show'; view: RailView }
  | { channel: typeof RAIL_CHANNEL; op: 'hide' };

export type RailRequest =
  | { channel: typeof RAIL_CHANNEL; op: 'open'; tab: PanelTab }
  | { channel: typeof RAIL_CHANNEL; op: 'sync' };

export function isRailCommand(message: unknown): message is RailCommand {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === RAIL_CHANNEL && (frame.op === 'show' || frame.op === 'hide');
}

export function isRailRequest(message: unknown): message is RailRequest {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === RAIL_CHANNEL && (frame.op === 'open' || frame.op === 'sync');
}

/** Lucide paths, copied so the content script carries no React and no icon package. */
export const RAIL_TABS: { id: PanelTab; label: string; paths: string[] }[] = [
  {
    id: 'chat',
    label: 'Chat',
    paths: [
      'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
      'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1',
    ],
  },
  {
    id: 'history',
    label: 'History',
    paths: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  },
  {
    id: 'skills',
    label: 'Skills',
    paths: [
      'M12 5v16',
      'M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z',
    ],
  },
  {
    id: 'recordings',
    label: 'Recordings',
    paths: [
      'm12.296 3.464 3.02 3.956',
      'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z',
      'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      'm6.18 5.276 3.1 3.899',
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    paths: [
      'M10 5H3',
      'M12 19H3',
      'M14 3v4',
      'M16 17v4',
      'M21 12h-9',
      'M21 19h-5',
      'M21 5h-7',
      'M8 10v4',
      'M8 12H3',
    ],
  },
];

/** The panel's tokens, spelled out — a content script has no stylesheet to read them from. */
export const RAIL_PALETTE = {
  ground: 'oklch(0.152 0.016 52)',
  ground2: 'oklch(0.183 0.018 50)',
  surface: 'oklch(0.213 0.019 48)',
  ink: 'oklch(0.958 0.012 70)',
  inkDim: 'oklch(0.735 0.018 60)',
  inkFaint: 'oklch(0.575 0.02 55)',
  line: 'oklch(0.98 0.01 60 / 12%)',
  brand: 'oklch(0.83 0.13 195)',
} as const;

export const RAIL_TONES: Record<RailTone, string> = {
  off: 'oklch(0.575 0.02 55 / 50%)',
  pending: 'oklch(0.84 0.15 85)',
  live: 'oklch(0.84 0.18 150)',
  busy: 'oklch(0.83 0.13 195)',
  listening: 'oklch(0.7 0.21 335)',
  warn: 'oklch(0.735 0.168 42)',
};
