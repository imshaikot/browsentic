export type LensOutcome = { picked: Element } | { cancelled: true } | { timedOut: true };

const HOST_ID = 'browsentic-a-eye';
const CURSOR_ID = 'browsentic-a-eye-cursor';

const ACCENT = '#ff7a3d';
const ACCENT_SOFT = 'rgba(255, 122, 61, .22)';

const CURSOR_PATHS = [
  'M3 7V5a2 2 0 0 1 2-2h2',
  'M17 3h2a2 2 0 0 1 2 2v2',
  'M21 17v2a2 2 0 0 1-2 2h-2',
  'M7 21H5a2 2 0 0 1-2-2v-2',
  'M7.5 12s1.8-3.2 4.5-3.2 4.5 3.2 4.5 3.2-1.8 3.2-4.5 3.2S7.5 12 7.5 12z',
];

const CURSOR = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg())}") 14 14, crosshair`;

const DEFAULT_HINT = 'Click the element you mean';

let picking = false;

export function lensIsUp(): boolean {
  return picking;
}

/**
 * The page is handed to the user for one click, and the page must not be able to tell the
 * difference between that click and nothing at all. The press sequence is only muted —
 * propagation stopped, default left alone — because preventing `pointerdown` would stop
 * the browser generating the `click` this waits on. `click` itself is the one that is
 * fully cancelled, so picking a link never also follows it.
 */
export function pickWithLens({ hint, timeoutMs }: { hint?: string; timeoutMs: number }): Promise<LensOutcome> {
  picking = true;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: static;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${styles()}</style><div class="box" hidden><span class="chip"></span></div><div class="hint"><b>A-Eye</b><span>${escape(hint?.trim() || DEFAULT_HINT)}</span><kbd>↑</kbd><span>wider</span><kbd>Esc</kbd><span>cancel</span></div>`;
  document.documentElement.append(host);

  const cursor = document.createElement('style');
  cursor.id = CURSOR_ID;
  cursor.textContent =
    `html, html *, html *::before, html *::after ` +
    `{ cursor: ${CURSOR} !important; user-select: none !important; }`;
  document.documentElement.append(cursor);

  const box = root.querySelector('.box') as HTMLElement;
  const chip = root.querySelector('.chip') as HTMLElement;

  let hovered: Element | null = null;

  return new Promise<LensOutcome>((resolve) => {
    const timer = setTimeout(() => settle({ timedOut: true }), timeoutMs);

    const mute = (event: Event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const swallow = (event: Event) => {
      event.preventDefault();
      mute(event);
    };

    const onMove = (event: PointerEvent) => aim(document.elementFromPoint(event.clientX, event.clientY));

    const onClick = (event: MouseEvent) => {
      swallow(event);
      const target = hovered ?? document.elementFromPoint(event.clientX, event.clientY);
      if (target && target !== document.documentElement) settle({ picked: target });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        swallow(event);
        settle({ cancelled: true });
        return;
      }
      if (event.key === 'ArrowUp' && hovered?.parentElement) {
        swallow(event);
        aim(hovered.parentElement);
      }
    };

    const onReflow = () => hovered && draw(hovered);

    const listeners: [string, EventListener, AddEventListenerOptions][] = [
      ['pointermove', onMove as EventListener, { capture: true, passive: true }],
      ['pointerdown', mute, { capture: true }],
      ['pointerup', mute, { capture: true }],
      ['mousedown', mute, { capture: true }],
      ['mouseup', mute, { capture: true }],
      ['dblclick', swallow, { capture: true }],
      ['auxclick', swallow, { capture: true }],
      ['contextmenu', swallow, { capture: true }],
      ['click', onClick as EventListener, { capture: true }],
      ['keydown', onKey as EventListener, { capture: true }],
      ['scroll', onReflow, { capture: true, passive: true }],
      ['resize', onReflow, { passive: true }],
    ];
    for (const [type, listener, options] of listeners) window.addEventListener(type, listener, options);

    function aim(target: Element | null): void {
      if (!target || target === host || target === document.documentElement) return;
      hovered = target;
      draw(target);
    }

    function draw(target: Element): void {
      const rect = target.getBoundingClientRect();
      box.hidden = false;
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.classList.toggle('below', rect.top < 24);
      chip.textContent = label(target, rect);
    }

    function settle(outcome: LensOutcome): void {
      clearTimeout(timer);
      for (const [type, listener, options] of listeners) {
        window.removeEventListener(type, listener, { capture: options.capture });
      }
      host.remove();
      cursor.remove();
      picking = false;
      resolve(outcome);
    }
  });
}

function label(target: Element, rect: DOMRect): string {
  const tag = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : '';
  const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
  return `${tag}${id} · ${size}`;
}

function cursorSvg(): string {
  const paths = CURSOR_PATHS.map((d) => `<path d="${d}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="rgba(0,0,0,.6)" stroke-width="4.5">${paths}</g>` +
    `<g stroke="${ACCENT}" stroke-width="2">${paths}</g>` +
    `<circle cx="12" cy="12" r="1.5" fill="${ACCENT}"/>` +
    `</svg>`
  );
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function styles(): string {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .box {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      border: 2px solid ${ACCENT};
      border-radius: 4px;
      background: ${ACCENT_SOFT};
      box-shadow: 0 0 0 1px rgb(0 0 0 / 35%), 0 0 22px -4px ${ACCENT};
      transition: left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear;
    }
    .chip {
      position: absolute;
      top: -21px;
      left: -2px;
      padding: 1px 6px;
      border-radius: 4px 4px 0 0;
      background: ${ACCENT};
      color: #1a0f08;
      font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap;
    }
    .box.below .chip { top: auto; bottom: -21px; border-radius: 0 0 4px 4px; }
    .hint {
      position: fixed;
      z-index: 2147483647;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 7px;
      max-width: min(92vw, 560px);
      padding: 7px 14px;
      border: 1px solid rgb(255 255 255 / 12%);
      border-radius: 999px;
      background: rgb(20 14 10 / 92%);
      color: #f4ece6;
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 12px 38px -12px rgb(0 0 0 / 80%);
      pointer-events: none;
      white-space: nowrap;
    }
    .hint b { color: ${ACCENT}; font-weight: 600; letter-spacing: 0.02em; }
    .hint span { opacity: 0.75; }
    .hint kbd {
      padding: 1px 5px;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 4px;
      font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      opacity: 0.9;
    }
    @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
  `;
}
