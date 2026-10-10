import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import type { LensCommand } from '@/lib/actions/page/lens';
import { PHONE_PORT, isMirrorKey, touchPoint, typedText, type FrameMetadata, type MirrorCommand, type MirrorMessage, type PageState } from '@/lib/phone/mirror';

const RECONNECT_MS = 500;
const ERROR_SHOWN_MS = 5_000;
/** How far a press travels during A-Eye before it is a drag that scrolls, not a pick. */
const PICK_SLOP_PX = 6;

export interface Mirror {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  page: PageState | null;
  image: { width: number; height: number } | null;
  error: string | undefined;
  /** A-Eye is waiting on the phone: hovering the picture aims its lens and a click picks. */
  picking: boolean;
  send(command: MirrorCommand): void;
}

const MAC = /mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '');

const decode = (data: string) => new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: 'image/jpeg' });

/** The page's half of the mirror: frames in and drawn, then acked; touches, wheel and keys out as the phone takes them, or to A-Eye's lens while it waits. */
export function useMirror(watching: boolean): Mirror {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const port = useRef<Browser.runtime.Port | null>(null);
  const metadata = useRef<FrameMetadata | null>(null);
  const watchingNow = useRef(watching);
  const pickingNow = useRef(false);
  const [page, setPage] = useState<PageState | null>(null);
  const [image, setImage] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);

  const send = useCallback((command: MirrorCommand) => port.current?.postMessage(command), []);

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const draw = async (message: Extract<MirrorMessage, { kind: 'frame' }>, from: Browser.runtime.Port) => {
      const bitmap = await createImageBitmap(decode(message.data));
      const target = canvas.current;
      if (target) {
        if (target.width !== bitmap.width || target.height !== bitmap.height) {
          target.width = bitmap.width;
          target.height = bitmap.height;
          setImage({ width: bitmap.width, height: bitmap.height });
        }
        target.getContext('2d')?.drawImage(bitmap, 0, 0);
      }
      bitmap.close();
      metadata.current = message.metadata;
      from.postMessage({ op: 'ack', frame: message.frame } satisfies MirrorCommand);
    };
    const lensUp = (active: boolean) => {
      pickingNow.current = active;
      setPicking(active);
    };
    const connect = () => {
      const opened = browser.runtime.connect({ name: PHONE_PORT });
      port.current = opened;
      opened.onMessage.addListener((raw) => {
        const message = raw as MirrorMessage;
        if (message.kind === 'frame') void draw(message, opened);
        else if (message.kind === 'page') setPage(message);
        else if (message.kind === 'lens') lensUp(message.active);
        else setError(message.message);
      });
      opened.onDisconnect.addListener(() => {
        if (port.current === opened) port.current = null;
        lensUp(false);
        if (live) retry = setTimeout(connect, RECONNECT_MS);
      });
      if (watchingNow.current) opened.postMessage({ op: 'watch' } satisfies MirrorCommand);
    };
    connect();
    return () => {
      live = false;
      clearTimeout(retry);
      port.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    watchingNow.current = watching;
    send({ op: watching ? 'watch' : 'unwatch' });
  }, [watching, send]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(undefined), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let lensPress: { clientX: number; clientY: number; point: { x: number; y: number }; dragging: boolean } | null = null;
    const at = (event: { clientX: number; clientY: number }) => {
      const frame = metadata.current;
      if (!frame || !target.width) return null;
      const box = target.getBoundingClientRect();
      return touchPoint({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }, frame, target);
    };
    const lens = (command: LensCommand) => send({ op: 'lens', lens: command });
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return;
      target.setPointerCapture(event.pointerId);
      target.focus();
      event.preventDefault();
      const point = at(event);
      if (!point) return;
      if (pickingNow.current) lensPress = { clientX: event.clientX, clientY: event.clientY, point, dragging: false };
      else send({ op: 'touch', type: 'touchStart', ...point });
    };
    const move = (event: PointerEvent) => {
      if (!target.hasPointerCapture(event.pointerId)) {
        const point = pickingNow.current ? at(event) : null;
        if (point) lens({ op: 'aim', ...point });
        return;
      }
      event.preventDefault();
      const point = at(event);
      if (!point) return;
      if (lensPress && !lensPress.dragging) {
        if (Math.hypot(event.clientX - lensPress.clientX, event.clientY - lensPress.clientY) < PICK_SLOP_PX) return;
        lensPress.dragging = true;
        send({ op: 'touch', type: 'touchStart', ...lensPress.point });
      }
      send({ op: 'touch', type: 'touchMove', ...point });
    };
    const lift = (type: 'touchEnd' | 'touchCancel') => (event: PointerEvent) => {
      if (!target.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      const point = at(event);
      const pressed = lensPress;
      lensPress = null;
      if (!point) return;
      if (pressed && !pressed.dragging) {
        if (type === 'touchEnd') lens({ op: 'pick', ...point });
      } else send({ op: 'touch', type, ...point });
    };
    const wheel = (event: WheelEvent) => {
      const point = at(event);
      if (point) send({ op: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
      event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      const text = typedText(event, MAC);
      if (text === undefined && (event.metaKey || event.ctrlKey || event.altKey)) return;
      if (pickingNow.current && event.key === 'Escape') lens({ op: 'cancel' });
      else if (pickingNow.current && event.key === 'ArrowUp') lens({ op: 'wider' });
      else if (isMirrorKey(event.key)) send({ op: 'key', key: event.key });
      else if (text !== undefined) send({ op: 'text', text });
      else return;
      event.preventDefault();
    };
    const paste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text) send({ op: 'text', text });
      event.preventDefault();
    };
    const listeners = [
      ['pointerdown', press],
      ['pointermove', move],
      ['pointerup', lift('touchEnd')],
      ['pointercancel', lift('touchCancel')],
      ['wheel', wheel],
      ['keydown', key],
      ['paste', paste],
    ] as const;
    for (const [type, listener] of listeners) target.addEventListener(type, listener as EventListener, { passive: false });
    return () => {
      for (const [type, listener] of listeners) target.removeEventListener(type, listener as EventListener);
    };
  }, [send]);

  return { canvas, page, image, error, picking, send };
}
