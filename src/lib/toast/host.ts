import { browser } from 'wxt/browser';
import { RAIL_PALETTES, RAIL_TONES } from '@/lib/rail/events';
import { MAX_TOASTS, TOAST_CHANNEL, isToastCommand, type ToastView } from './events';

export { TOAST_CHANNEL } from './events';

const HOST_ID = 'browsentic-toast';
const EXIT_MS = 180;

/**
 * Completion notices drawn into whatever page the user is looking at, because an OS
 * notification is a banner they have already walked past. Same closed shadow root as the
 * rail — the page can neither style it nor read it, and `extractText` never sees it.
 */
export function exposeToast(): void {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let stack: HTMLElement | null = null;
  const timers = new Map<string, () => void>();

  /* Answered through sendResponse, not a returned promise: on Chrome `browser` is the raw
     `chrome` object, which honours only a literal `true` return and would drop the verdict
     the background needs to decide whether an OS notification is still owed. Both drawing
     calls are synchronous, so the response goes out before this listener returns. */
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isToastCommand(message)) return;
    if (message.op === 'hide') {
      if (message.toastId) dismiss(message.toastId);
      else clear();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: render(message.view) });
  });

  /* A card left by a previous extension life is dead markup — its click reaches nothing. */
  document.getElementById(HOST_ID)?.remove();
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) clear();
  });

  function clear(): void {
    for (const cancel of timers.values()) cancel();
    timers.clear();
    host?.remove();
    host = null;
    root = null;
    stack = null;
  }

  function dismiss(toastId: string): void {
    timers.get(toastId)?.();
    timers.delete(toastId);
    const card = stack?.querySelector<HTMLElement>(`[data-toast="${CSS.escape(toastId)}"]`);
    if (!card) return;
    card.classList.add('out');
    setTimeout(() => {
      card.remove();
      if (stack && !stack.childElementCount) clear();
    }, EXIT_MS);
  }

  function mount(view: ToastView): boolean {
    if (!document.documentElement) return false;
    if (!host || !host.isConnected) {
      clear();
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'all: initial; position: static;';
      root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${STYLES}</style><div class="stack" role="region" aria-label="Browsentic"></div>`;
      stack = root.querySelector('.stack');
      document.documentElement.append(host);
    }
    if (!stack) return false;
    const palette = RAIL_PALETTES[view.theme];
    for (const [key, value] of Object.entries(palette)) stack.style.setProperty(`--${key}`, value);
    return true;
  }

  function render(view: ToastView): boolean {
    if (!mount(view)) return false;
    dismissNow(view.toastId);

    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.toast = view.toastId;
    card.setAttribute('role', 'status');
    card.style.setProperty('--tone', RAIL_TONES[view.theme][view.tone]);
    card.innerHTML = `
      <button type="button" class="close" aria-label="Dismiss">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <div class="head"><span class="dot"></span><span class="title"></span></div>
      <p class="body"></p>
      <span class="cue"></span>
      <span class="bar"><i></i></span>`;

    card.querySelector<HTMLElement>('.title')!.textContent = view.title;
    card.querySelector<HTMLElement>('.body')!.textContent = view.body;

    const cue = card.querySelector<HTMLElement>('.cue')!;
    if (view.tabId == null) cue.remove();
    else {
      cue.textContent = 'Click to open the tab';
      card.classList.add('go');
      card.addEventListener('click', () => {
        void browser.runtime
          .sendMessage({ channel: TOAST_CHANNEL, op: 'activate', tabId: view.tabId })
          .catch(() => undefined);
        dismiss(view.toastId);
      });
    }

    card.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismiss(view.toastId);
    });

    card.querySelector<HTMLElement>('.bar i')!.style.animationDuration = `${view.durationMs}ms`;

    stack!.append(card);
    while (stack!.childElementCount > MAX_TOASTS) {
      const oldest = (stack!.firstElementChild as HTMLElement | null)?.dataset.toast;
      if (!oldest) break;
      dismissNow(oldest);
    }

    arm(card, view.toastId, view.durationMs);
    return true;
  }

  /* Ten seconds of a minimized window is ten seconds nobody saw. The countdown — and the
     bar that draws it — only starts once the document is on screen. */
  function arm(card: HTMLElement, toastId: string, durationMs: number): void {
    if (document.visibilityState === 'visible') {
      card.classList.remove('wait');
      const handle = setTimeout(() => dismiss(toastId), durationMs);
      timers.set(toastId, () => clearTimeout(handle));
      return;
    }
    card.classList.add('wait');
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      arm(card, toastId, durationMs);
    };
    document.addEventListener('visibilitychange', onVisible);
    timers.set(toastId, () => document.removeEventListener('visibilitychange', onVisible));
  }

  function dismissNow(toastId: string): void {
    timers.get(toastId)?.();
    timers.delete(toastId);
    stack?.querySelector(`[data-toast="${CSS.escape(toastId)}"]`)?.remove();
  }
}

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .stack {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
    max-width: calc(100vw - 32px);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    pointer-events: none;
  }
  .card {
    position: relative;
    overflow: hidden;
    padding: 12px 34px 13px 13px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--ground2);
    box-shadow: 0 14px 40px -14px rgb(0 0 0 / 70%), 0 0 0 1px rgb(0 0 0 / 25%);
    pointer-events: auto;
    animation: browsentic-toast-in 200ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .card.go { cursor: pointer; }
  .card.go:hover { background: var(--surface); }
  .card.out { animation: browsentic-toast-out ${EXIT_MS}ms ease-in forwards; }
  .head { display: flex; align-items: center; gap: 7px; }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--tone);
    box-shadow: 0 0 8px 1px color-mix(in oklch, var(--tone) 70%, transparent);
  }
  .title {
    font: 600 13px/1.35 inherit;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body { margin-top: 4px; font: 400 12px/1.45 inherit; color: var(--inkDim); }
  .cue { display: block; margin-top: 6px; font: 500 11px/1.4 inherit; color: var(--brand); }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--inkFaint);
    cursor: pointer;
  }
  .close:hover { background: var(--surface); color: var(--ink); }
  .close svg { width: 12px; height: 12px; display: block; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--line); }
  .bar i { display: block; height: 100%; background: var(--tone); animation: browsentic-toast-drain linear forwards; }
  .card.wait .bar i { animation-play-state: paused; }
  @keyframes browsentic-toast-in { from { opacity: 0; transform: translateX(14px); } }
  @keyframes browsentic-toast-out { to { opacity: 0; transform: translateX(14px); } }
  @keyframes browsentic-toast-drain { from { width: 100%; } to { width: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .card, .card.out { animation: none; }
    .bar i { width: 100%; animation: none; }
  }
`;
