import type { ThemeId } from '@/lib/settings/theme';

export const CUE_CHANNEL = 'browsentic/cue';

export const CUE_LINGER_MS = 700;

export const CUE_FADE_MS = 220;

export interface CueTarget {
  selector?: string;
  text?: string;
  role?: string;
  nth: number;
}

export interface CuePoint {
  x: number;
  y: number;
}

export type CueAnchor =
  | { target: CueTarget; includeHidden?: boolean }
  | { point: CuePoint }
  | { focused: true };

export interface CuePlan {
  kind: 'none' | 'element' | 'page';
  verb: string;
  detail?: string;
  anchors: CueAnchor[];
  quench?: boolean;
}

export type CueCommand =
  | { channel: typeof CUE_CHANNEL; op: 'show'; id: string; plan: CuePlan; theme: ThemeId }
  | { channel: typeof CUE_CHANNEL; op: 'settle'; id: string; ok: boolean }
  | { channel: typeof CUE_CHANNEL; op: 'quench' };

const OPS: readonly unknown[] = ['show', 'settle', 'quench'];

export function isCueCommand(message: unknown): message is CueCommand {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === CUE_CHANNEL && OPS.includes(frame.op);
}
