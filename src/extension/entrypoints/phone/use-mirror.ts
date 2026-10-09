import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { PHONE_PORT, isMirrorKey, touchPoint, type FrameMetadata, type MirrorCommand, type MirrorMessage, type PageState, type TouchType } from '@/lib/phone/mirror';

const RECONNECT_MS = 500;
const ERROR_SHOWN_MS = 5_000;

export interface Mirror {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  page: PageState | null;
  image: { width: number; height: number } | null;
  error: string | undefined;
  send(command: MirrorCommand): void;
}

const decode = (data: string) => new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: 'image/jpeg' });

/** The page's half of the mirror: frames in and drawn, then acked; touches, wheel and keys out as the phone takes them. */
export function useMirror(watching: boolean): Mirror {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const port = useRef<Browser.runtime.Port | null>(null);
  const metadata = useRef<FrameMetadata | null>(null);
  const watchingNow = useRef(watching);
  const [page, setPage] = useState<PageState | null>(null);
  const [image, setImage] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string>();

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
    const connect = () => {
      const opened = browser.runtime.connect({ name: PHONE_PORT });
      port.current = opened;
      opened.onMessage.addListener((raw) => {
        const message = raw as MirrorMessage;
        if (message.kind === 'frame') void draw(message, opened);
        else if (message.kind === 'page') setPage(message);
        else setError(message.message);
      });
      opened.onDisconnect.addListener(() => {
        if (port.current === opened) port.current = null;
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
    const at = (event: { clientX: number; clientY: number }) => {
      const frame = metadata.current;
      if (!frame || !target.width) return null;
      const box = target.getBoundingClientRect();
      return touchPoint({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }, frame, target);
    };
    const touch = (type: TouchType) => (event: PointerEvent) => {
      if (type !== 'touchStart' && !target.hasPointerCapture(event.pointerId)) return;
      if (type === 'touchStart') {
        target.setPointerCapture(event.pointerId);
        target.focus();
      }
      const point = at(event);
      if (point) send({ op: 'touch', type, ...point });
      event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      const point = at(event);
      if (point) send({ op: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
      event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isMirrorKey(event.key)) send({ op: 'key', key: event.key });
      else if (event.key.length === 1) send({ op: 'text', text: event.key });
      else return;
      event.preventDefault();
    };
    const paste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text) send({ op: 'text', text });
      event.preventDefault();
    };
    const listeners = [
      ['pointerdown', touch('touchStart')],
      ['pointermove', touch('touchMove')],
      ['pointerup', touch('touchEnd')],
      ['pointercancel', touch('touchCancel')],
      ['wheel', wheel],
      ['keydown', key],
      ['paste', paste],
    ] as const;
    for (const [type, listener] of listeners) target.addEventListener(type, listener as EventListener, { passive: false });
    return () => {
      for (const [type, listener] of listeners) target.removeEventListener(type, listener as EventListener);
    };
  }, [send]);

  return { canvas, page, image, error, send };
}
