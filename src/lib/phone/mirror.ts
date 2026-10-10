import type { LensCommand } from '@/lib/actions/page/lens';

export const PHONE_PORT = 'browsentic/phone';

/** `Page.screencastFrame`'s metadata: the phone's visual viewport when the frame was taken. */
export interface FrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}

export type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';

export const MIRROR_KEYS = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
export type MirrorKey = (typeof MIRROR_KEYS)[number];

export const isMirrorKey = (key: string): key is MirrorKey => (MIRROR_KEYS as readonly string[]).includes(key);

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'getModifierState'>;

/**
 * The character a key press types, or undefined for a shortcut. AltGr reads as Ctrl+Alt on Windows,
 * and Option alone types on a Mac, so both type: that is how `@`, `€` or `{` come on many layouts.
 */
export function typedText(press: KeyPress, mac: boolean): string | undefined {
  if (press.key.length !== 1 || press.metaKey) return undefined;
  if (press.getModifierState('AltGraph') || press.ctrlKey === press.altKey) return press.key;
  return mac && press.altKey ? press.key : undefined;
}

export type MirrorCommand =
  | { op: 'watch' }
  | { op: 'unwatch' }
  | { op: 'restart' }
  | { op: 'ack'; frame: number }
  | { op: 'touch'; type: TouchType; x: number; y: number }
  | { op: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { op: 'text'; text: string }
  | { op: 'key'; key: MirrorKey }
  /** While A-Eye waits on the phone; points are where a touch would land. */
  | { op: 'lens'; lens: LensCommand }
  | { op: 'go'; url: string }
  | { op: 'back' }
  | { op: 'forward' }
  | { op: 'reload' }
  | { op: 'switchTab'; targetId: string }
  | { op: 'newTab' }
  | { op: 'closeTab'; targetId: string };

export interface PageState {
  targetId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type MirrorMessage =
  | { kind: 'frame'; data: string; metadata: FrameMetadata; frame: number }
  | ({ kind: 'page' } & PageState)
  | { kind: 'lens'; active: boolean }
  | { kind: 'error'; message: string };

/**
 * Where a point on the drawn frame lands on the phone, in the CSS px a touch event takes. The frame
 * is the visual viewport alone, so the phone's own top bar plays no part (spike Q8).
 */
export function touchPoint(
  fraction: { x: number; y: number },
  metadata: Pick<FrameMetadata, 'deviceWidth' | 'pageScaleFactor'>,
  image: { width: number; height: number },
): { x: number; y: number } {
  const width = metadata.deviceWidth / (metadata.pageScaleFactor || 1);
  return { x: fraction.x * width, y: fraction.y * width * (image.height / image.width) };
}

/** Key events that edit only with `windowsVirtualKeyCode`, and an Enter that submits only as `keyDown` with its `text` (spike Q7). */
const KEYS: Record<MirrorKey, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

export function keyEvents(key: MirrorKey): Record<string, unknown>[] {
  const { code, keyCode, text } = KEYS[key];
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  return [{ type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) }, { type: 'keyUp', ...base }];
}

/** What the mirror's address bar was given, as a URL: a bare host gets https://, anything else is searched for. */
export function addressOf(typed: string): string {
  const text = typed.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data):/i.test(text)) return text;
  if (/^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(text) || /^localhost(:\d+)?(\/\S*)?$/.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
