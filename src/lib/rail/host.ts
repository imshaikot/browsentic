import { browser } from 'wxt/browser';
import {
  RAIL_CHANNEL,
  RAIL_PALETTE,
  RAIL_TABS,
  RAIL_TONES,
  isRailCommand,
  type PanelTab,
  type RailView,
} from './events';

export { RAIL_CHANNEL } from './events';

const HOST_ID = 'browsentic-rail';

/**
 * The minimized panel, drawn into the page. It lives in a closed shadow root so the
 * page cannot style or read it and `extractText` cannot pick it up, and it is only ever
 * as wide as its icons — the side panel is closed while this is up.
 */
export function exposeRail(): void {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRailCommand(message)) return;
    if (message.op === 'show') render(message.view);
    else remove();
    return Promise.resolve({ ok: true });
  });

  /* A rail drawn by a previous extension life — before a reload, or before this page went
     into the back/forward cache — is dead markup: its click handlers reach nothing. Drop it
     and ask the background whether a live one belongs here. */
  document.getElementById(HOST_ID)?.remove();
  resync();
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    remove();
    resync();
  });

  function resync(): void {
    void browser.runtime.sendMessage({ channel: RAIL_CHANNEL, op: 'sync' }).catch(() => undefined);
  }

  function remove(): void {
    host?.remove();
    host = null;
    root = null;
  }

  function render(view: RailView): void {
    if (!document.documentElement) return;
    if (!host || !host.isConnected) {
      remove();
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('aria-hidden', 'false');
      host.style.cssText = 'all: initial; position: static;';
      root = host.attachShadow({ mode: 'closed' });
      document.documentElement.append(host);
    }
    if (!root) return;

    root.innerHTML = `<style>${styles(view)}</style>${markup(view)}`;

    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void browser.runtime.sendMessage({
          channel: RAIL_CHANNEL,
          op: 'open',
          tab: button.dataset.tab as PanelTab,
        });
      });
    }
  }
}

function markup(view: RailView): string {
  const tabs = RAIL_TABS.map(({ id, label, paths }) => {
    const active = id === view.tab;
    const busy = id === 'chat' && view.running > 0;
    const count = view.counts[id] ?? 0;
    const mark = busy
      ? '<span class="mark busy"></span>'
      : count > 0
        ? '<span class="mark"></span>'
        : '';
    const title = busy ? `${label} — ${runLabel(view.running)}` : label;
    return `<button type="button" data-tab="${id}" class="tab${active ? ' active' : ''}" title="${escape(title)}" aria-label="${escape(label)}">${icon(paths)}${mark}</button>`;
  }).join('');

  const runs =
    view.running > 0
      ? `<span class="runs" title="${escape(runLabel(view.running))}"><i></i><i></i><i></i><b>${view.running}</b></span>`
      : '';

  return `<div class="rail" role="toolbar" aria-label="Browsentic">${tabs}<span class="sep"></span>${runs}<span class="status" title="${escape(view.status)}"></span></div>`;
}

function icon(paths: string[]): string {
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function runLabel(running: number): string {
  return running === 1 ? 'A run is in progress' : `${running} runs are in progress`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function styles(view: RailView): string {
  const edge = view.side === 'left' ? 'left: 12px' : 'right: 12px';
  return `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .rail {
      position: fixed;
      ${edge};
      top: 50%;
      transform: translateY(-50%);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      width: 44px;
      padding: 6px 0;
      border: 1px solid ${RAIL_PALETTE.line};
      border-radius: 16px;
      background: ${RAIL_PALETTE.ground2};
      box-shadow: 0 10px 34px -12px rgb(0 0 0 / 70%), 0 0 0 1px rgb(0 0 0 / 25%);
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      ${view.running > 0 ? `outline: 1px solid color-mix(in oklch, ${RAIL_PALETTE.brand} 45%, transparent); outline-offset: -1px;` : ''}
    }
    .tab {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 11px;
      background: transparent;
      color: ${RAIL_PALETTE.inkFaint};
      cursor: pointer;
      transition: background-color 150ms, color 150ms;
    }
    .tab:hover { background: ${RAIL_PALETTE.surface}; color: ${RAIL_PALETTE.ink}; }
    .tab.active { background: color-mix(in oklch, ${RAIL_PALETTE.brand} 14%, transparent); color: ${RAIL_PALETTE.brand}; }
    .tab svg { width: 17px; height: 17px; display: block; }
    .mark {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: ${RAIL_PALETTE.inkFaint};
    }
    .mark.busy {
      background: ${RAIL_PALETTE.brand};
      box-shadow: 0 0 8px 1px color-mix(in oklch, ${RAIL_PALETTE.brand} 75%, transparent);
      animation: browsentic-rail-pulse 1.4s ease-in-out infinite;
    }
    .sep { width: 20px; height: 1px; background: ${RAIL_PALETTE.line}; margin: 3px 0; }
    .runs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: center; width: 32px; }
    .runs i {
      width: 4px;
      height: 4px;
      border-radius: 999px;
      background: ${RAIL_PALETTE.brand};
      animation: browsentic-rail-think 1.2s ease-in-out infinite;
    }
    .runs i:nth-child(2) { animation-delay: 0.16s; }
    .runs i:nth-child(3) { animation-delay: 0.32s; }
    .runs b {
      width: 100%;
      text-align: center;
      font: 600 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: ${RAIL_PALETTE.brand};
      font-variant-numeric: tabular-nums;
    }
    .status {
      width: 7px;
      height: 7px;
      margin: 2px 0 1px;
      border-radius: 999px;
      background: ${RAIL_TONES[view.tone]};
      box-shadow: 0 0 8px 1px color-mix(in oklch, ${RAIL_TONES[view.tone]} 70%, transparent);
    }
    @keyframes browsentic-rail-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @keyframes browsentic-rail-think {
      0%, 70%, 100% { opacity: 0.25; transform: translateY(0); }
      35% { opacity: 1; transform: translateY(-2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .mark.busy, .runs i { animation: none; }
    }
  `;
}
