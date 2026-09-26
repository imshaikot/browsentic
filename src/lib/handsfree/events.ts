import type { FocusedElement } from '@/lib/actions/protocol';
import type { ThemeId } from '@/lib/bridge/theme';

export const HANDS_FREE_CHANNEL = 'browsentic/handsFree';
export const DICTATION_CHANNEL = 'browsentic/dictation';

export const AUTO_SEND_MS = 1600;

/** What the offscreen recognizer reports about itself. `held`: in hold-to-talk, ready and waiting for the key. */
export type DictationPhase =
  | 'starting'
  | 'listening'
  | 'held'
  | 'needs-mic'
  | 'blocked'
  | 'no-mic'
  | 'no-service'
  | 'yielded';

/**
 * Hold-to-talk's key: left Control, matched by where it sits rather than what it types, so every
 * layout agrees on it. Alone it does nothing on any platform or browser, and it sits at the far
 * left on both Mac and PC keyboards.
 */
export const HOLD_KEY_CODE = 'ControlLeft';

/**
 * What the orb in one tab should say about the microphone. `paused` is every reason the
 * background is not listening for this tab that the user did not choose — another tab in
 * front, the agent working, the browser in the background.
 */
export type OrbVoice = DictationPhase | 'muted' | 'paused';

export type OrbLink = 'live' | 'pending' | 'off';

export type OrbRun = 'idle' | 'working' | 'approval';

/** The orb's centre, as fractions of the viewport, so one position fits every tab. */
export interface OrbPosition {
  x: number;
  y: number;
}

export interface OrbApproval {
  toolId: string;
  action: string;
  site?: string;
  /** For code the agent wrote: what it says the code is for, and the code itself. */
  purpose?: string;
  code?: string;
  /** For any other action: its input, flattened to one short line. */
  detail?: string;
}

export interface OrbView {
  theme: ThemeId;
  since: number;
  position: OrbPosition | null;
  link: OrbLink;
  run: OrbRun;
  voice: OrbVoice;
  /** The mic stays off until the hold key is held, and letting go sends. */
  pushToTalk: boolean;
  approval?: OrbApproval;
}

export type CaptionTone = 'reply' | 'error' | 'ask';

export type OrbCommand =
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'show'; view: OrbView }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'hide' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'heard'; text: string; final: boolean }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'say'; text: string; tone: CaptionTone };

export interface OrbFile {
  name: string;
  mime: string;
  size: number;
  /** Base64, absent when the file is over the stored-file cap and travels by name and size only. */
  content?: string;
}

export type OrbRequest =
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'sync' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'submit'; text: string; focus?: FocusedElement; liveTools: boolean }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'cancel' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'decide'; toolId: string; allow: boolean; remember?: boolean }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'openPanel' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'listen'; on: boolean }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'grantMic' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'pick' }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'attach'; file: OrbFile }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'detach'; fileId: string }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'move'; position: OrbPosition }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'pushToTalk'; on: boolean }
  | { channel: typeof HANDS_FREE_CHANNEL; op: 'talk'; on: boolean };

export type DictationReport =
  | { channel: typeof DICTATION_CHANNEL; op: 'phase'; phase: DictationPhase }
  | { channel: typeof DICTATION_CHANNEL; op: 'heard'; text: string; final: boolean };

/** Sent to a hold-to-talk dictation page: start hearing, or finish what was said and stop. */
export type DictationCommand = { channel: typeof DICTATION_CHANNEL; op: 'talk'; on: boolean };

const ORB_COMMANDS = new Set(['show', 'hide', 'heard', 'say']);
const ORB_REQUESTS = new Set([
  'sync', 'submit', 'cancel', 'decide', 'openPanel', 'listen', 'grantMic', 'pick', 'attach', 'detach', 'move',
  'pushToTalk', 'talk',
]);

function onChannel(message: unknown, channel: string, ops: Set<string>): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === channel && typeof frame.op === 'string' && ops.has(frame.op);
}

export const isOrbCommand = (message: unknown): message is OrbCommand =>
  onChannel(message, HANDS_FREE_CHANNEL, ORB_COMMANDS);

export const isOrbRequest = (message: unknown): message is OrbRequest =>
  onChannel(message, HANDS_FREE_CHANNEL, ORB_REQUESTS);

export const isDictationReport = (message: unknown): message is DictationReport =>
  onChannel(message, DICTATION_CHANNEL, new Set(['phase', 'heard']));

export const isDictationCommand = (message: unknown): message is DictationCommand =>
  onChannel(message, DICTATION_CHANNEL, new Set(['talk']));

/** Lucide paths, copied for the same reason as the rail's: the content script carries no icon package. */
export const ORB_ICONS = {
  mic: ['M12 19v3', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z'],
  micOff: [
    'M12 19v3',
    'M15 9.34V5a3 3 0 0 0-5.68-1.33',
    'M16.95 16.95A7 7 0 0 1 5 12v-2',
    'M18.89 13.23A7 7 0 0 0 19 12v-2',
    'm2 2 20 20',
    'M9 9v3a3 3 0 0 0 5.12 2.12',
  ],
  stop: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'],
  shield: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    'M12 8v4',
    'M12 16h.01',
  ],
  file: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M12 12v6',
    'm15 15-3-3-3 3',
  ],
  code: ['m18 16 4-4-4-4', 'm6 8-4 4 4 4', 'm14.5 4-5 16'],
  focus: [
    'M3 7V5a2 2 0 0 1 2-2h2',
    'M17 3h2a2 2 0 0 1 2 2v2',
    'M21 17v2a2 2 0 0 1-2 2h-2',
    'M7 21H5a2 2 0 0 1-2-2v-2',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0',
  ],
  panel: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M15 3v18', 'm10 15-3-3 3-3'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  keyboard: [
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M10 8h.01',
    'M12 12h.01',
    'M14 8h.01',
    'M16 12h.01',
    'M18 8h.01',
    'M6 8h.01',
    'M7 16h10',
    'M8 12h.01',
  ],
} as const;

export type OrbIcon = keyof typeof ORB_ICONS;
