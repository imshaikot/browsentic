import { browser } from 'wxt/browser';
import { frameIdOf, isFrameElement, type FrameElement } from '@/lib/actions/page/switch-frame';
import { FRAME_MARK_ATTRIBUTE, isFrameProbe, type FrameDescription, type FrameOrigin } from './events';

export function exposeFrameProbe(): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isFrameProbe(message)) return;
    switch (message.op) {
      case 'describe':
        sendResponse(describeFrame());
        return;
      case 'mark':
        document.documentElement.setAttribute(FRAME_MARK_ATTRIBUTE, message.token);
        sendResponse({ ok: true });
        return;
      case 'unmark':
        document.documentElement.removeAttribute(FRAME_MARK_ATTRIBUTE);
        sendResponse({ ok: true });
        return;
      case 'locate':
        sendResponse(locateChild(message.frameId));
        return;
    }
  });
}

function describeFrame(): FrameDescription {
  return {
    url: location.href,
    title: document.title,
    top: window === window.top,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
}

function locateChild(frameId: number): FrameOrigin | null {
  const child = [...document.querySelectorAll('iframe,frame')].filter(isFrameElement).find((el) => hostsFrame(el, frameId));
  if (!child) return null;
  const rect = child.getBoundingClientRect();
  const style = getComputedStyle(child);
  return {
    x: rect.x + child.clientLeft + parseFloat(style.paddingLeft),
    y: rect.y + child.clientTop + parseFloat(style.paddingTop),
  };
}

function hostsFrame(el: FrameElement, frameId: number): boolean {
  try {
    return frameIdOf(el) === frameId;
  } catch {
    return false;
  }
}
