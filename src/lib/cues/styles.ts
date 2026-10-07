import type { ThemeId } from '@/lib/settings/theme';
import { CUE_FADE_MS } from './events';

/** --glow in globals.css, theme by theme; the page has no stylesheet to read it from. */
export const CUE_GLOW: Record<ThemeId, string> = {
  ember: '72%',
  midnight: '72%',
  phosphor: '85%',
  daylight: '26%',
};

export const HOST_STYLE = [
  'all: initial',
  'position: fixed',
  'inset: 0',
  'width: 100vw',
  'height: 100vh',
  'max-width: none',
  'max-height: none',
  'margin: 0',
  'padding: 0',
  'border: 0',
  'background: transparent',
  'overflow: visible',
  'pointer-events: none',
  'display: block',
  'z-index: 2147483647',
].join('; ');

export const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; pointer-events: none; }
  .layer {
    position: fixed;
    inset: 0;
    overflow: hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .cue { --tone: var(--brand); position: absolute; inset: 0; transition: opacity ${CUE_FADE_MS}ms ease-out; }
  .cue.failed { --tone: var(--warn); }
  .cue.out { opacity: 0; }
  .ring {
    position: absolute;
    left: 0;
    top: 0;
    border: 2px solid var(--tone);
    border-radius: 8px;
    box-shadow:
      0 0 0 1px color-mix(in oklch, var(--tone) 22%, transparent),
      0 0 18px 1px color-mix(in oklch, var(--tone) var(--glow), transparent),
      inset 0 0 12px -4px color-mix(in oklch, var(--tone) var(--glow), transparent);
    will-change: transform;
    animation: browsentic-cue-in 160ms ease-out, browsentic-cue-pulse 1.4s ease-in-out 160ms infinite;
  }
  .ring.point { border-radius: 999px; }
  .ring.hidden, .chip.hidden, .edge.hidden { display: none; }
  .cue.done .ring, .cue.failed .ring { animation: none; }
  .edge {
    position: absolute;
    inset: 0;
    box-shadow:
      inset 0 0 0 2px color-mix(in oklch, var(--tone) 70%, transparent),
      inset 0 0 38px -6px color-mix(in oklch, var(--tone) var(--glow), transparent);
    animation: browsentic-cue-in 160ms ease-out, browsentic-cue-breathe 1.6s ease-in-out 160ms infinite;
  }
  .cue.done .edge, .cue.failed .edge { animation: none; }
  .chip {
    position: absolute;
    left: 0;
    top: 0;
    max-width: calc(100vw - 16px);
    padding: 3px 9px 4px;
    border: 1px solid color-mix(in oklch, var(--tone) 45%, transparent);
    border-radius: 999px;
    background: var(--ground2);
    color: var(--ink);
    font: 600 11px/1.3 inherit;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 26px -10px color-mix(in oklch, var(--tone) var(--glow), transparent);
    will-change: transform;
  }
  .chip i { font-style: normal; color: var(--tone); }
  @keyframes browsentic-cue-in { from { opacity: 0; } }
  @keyframes browsentic-cue-pulse {
    50% {
      box-shadow:
        0 0 0 3px color-mix(in oklch, var(--tone) 18%, transparent),
        0 0 26px 3px color-mix(in oklch, var(--tone) var(--glow), transparent),
        inset 0 0 12px -4px color-mix(in oklch, var(--tone) var(--glow), transparent);
    }
  }
  @keyframes browsentic-cue-breathe { 50% { opacity: 0.65; } }
  @media (prefers-reduced-motion: reduce) {
    .cue { transition: none; }
    .ring, .edge { animation: none; }
  }
  @media print { .layer { display: none; } }
`;
