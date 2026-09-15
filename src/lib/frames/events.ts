export const FRAME_CHANNEL = 'browsentic/frame';

export const FRAME_MARK_ATTRIBUTE = 'data-browsentic-frame';

export type FrameProbeBody =
  | { op: 'describe' }
  | { op: 'mark'; token: string }
  | { op: 'unmark' }
  | { op: 'locate'; frameId: number };

export type FrameProbe = FrameProbeBody & { channel: typeof FRAME_CHANNEL };

export interface FrameDescription {
  url: string;
  title: string;
  top: boolean;
  viewport: { w: number; h: number };
}

export interface FrameOrigin {
  x: number;
  y: number;
}

export function isFrameProbe(message: unknown): message is FrameProbe {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { channel?: unknown }).channel === FRAME_CHANNEL &&
    typeof (message as { op?: unknown }).op === 'string'
  );
}
