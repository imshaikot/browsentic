import { AUTO_SEND_MS } from './events';
import { MENU_ITEM, ORB_SIZE } from './geometry';

const RING = 2 * Math.PI * 33;

/** The panel's look, spelled out for a surface with no stylesheet: its tokens, its easing, its token animation. */
export const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .layer {
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
    --spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --shade: rgb(0 0 0 / 70%);
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-family: var(--sans);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  .layer[data-light] { --shade: rgb(40 30 20 / 28%); }
  svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  .wrap {
    position: fixed;
    z-index: 2147483646;
    width: ${ORB_SIZE}px;
    height: ${ORB_SIZE}px;
    margin: -${ORB_SIZE / 2}px 0 0 -${ORB_SIZE / 2}px;
    transition: opacity 180ms ease, transform 420ms var(--spring);
  }
  .wrap.gliding { transition: opacity 180ms ease, transform 420ms var(--spring), left 380ms var(--ease), top 380ms var(--ease); }
  .wrap.entering { animation: orb-rise 620ms var(--spring) both; }
  .wrap.arriving { animation: orb-fade 220ms ease both; }
  .wrap.leaving { opacity: 0; transform: translateY(18px) scale(0.7); transition: opacity 200ms ease, transform 220ms ease-in; }
  .wrap.picking { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 160ms ease, visibility 0s linear 160ms; }

  .orb {
    all: unset;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${ORB_SIZE}px;
    height: ${ORB_SIZE}px;
    border-radius: 999px;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    color: var(--inkDim);
    border: 1px solid var(--line);
    background:
      radial-gradient(circle at 50% 28%, color-mix(in oklch, var(--ink) 9%, transparent), transparent 62%),
      var(--ground2);
    box-shadow:
      0 16px 40px -14px var(--shade),
      0 0 0 1px rgb(0 0 0 / 22%),
      0 6px 26px -10px color-mix(in oklch, var(--accent, var(--brand)) 55%, transparent);
    transition: transform 260ms var(--ease), box-shadow 260ms var(--ease), border-color 200ms ease, color 200ms ease;
  }
  .orb:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent, var(--brand)) 40%, var(--line)); }
  .orb:focus-visible { outline: 2px solid color-mix(in oklch, var(--brand) 70%, transparent); outline-offset: 3px; }
  .wrap.lifted .orb {
    transform: scale(1.12);
    cursor: grabbing;
    box-shadow:
      0 26px 56px -16px var(--shade),
      0 0 0 1px rgb(0 0 0 / 22%),
      0 10px 34px -8px color-mix(in oklch, var(--accent, var(--brand)) 70%, transparent);
  }

  .face { position: absolute; width: 22px; height: 22px; opacity: 0; transform: scale(0.6); transition: opacity 180ms ease, transform 260ms var(--ease); }
  .wrap[data-face="mic"] .face.mic,
  .wrap[data-face="off"] .face.off,
  .wrap[data-face="shield"] .face.shield,
  .wrap[data-face="dots"] .face.dots { opacity: 1; transform: none; }
  .wrap[data-face="dots"] .orb:hover .face.dots { opacity: 0; transform: scale(0.6); }
  .wrap[data-face="dots"] .orb:hover .face.stop { opacity: 1; transform: none; }
  .face.stop { width: 16px; height: 16px; color: var(--ember); }
  .face.stop svg { fill: currentColor; }
  .face.dots { display: flex; align-items: center; justify-content: center; gap: 4px; }
  .face.dots i { width: 5px; height: 5px; border-radius: 999px; background: var(--brand); animation: orb-think 1.2s ease-in-out infinite; }
  .face.dots i:nth-child(2) { animation-delay: 0.16s; }
  .face.dots i:nth-child(3) { animation-delay: 0.32s; }

  .wrap[data-tone="listen"] { --accent: var(--magenta); }
  .wrap[data-tone="listen"] .orb { color: var(--magenta); animation: orb-breathe 2.6s ease-in-out infinite; }
  .wrap[data-tone="work"] { --accent: var(--brand); }
  .wrap[data-tone="work"] .orb { color: var(--brand); animation: orb-glow 1.6s ease-in-out infinite; }
  .wrap[data-tone="ask"] { --accent: var(--ember); }
  .wrap[data-tone="ask"] .orb { color: var(--ember); border-color: color-mix(in oklch, var(--ember) 55%, transparent); }
  .wrap[data-tone="trouble"] { --accent: var(--amber); }
  .wrap[data-tone="trouble"] .orb { color: var(--amber); }
  .wrap[data-tone="quiet"] .orb { color: var(--inkFaint); }

  .ping, .ping2 {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    pointer-events: none;
    background: color-mix(in oklch, var(--accent, var(--magenta)) 30%, transparent);
    opacity: 0;
  }
  .wrap.speaking .ping { animation: orb-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
  .wrap.speaking .ping2 { animation: orb-ping 1s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite; }
  .wrap.speaking .orb {
    border-color: color-mix(in oklch, var(--magenta) 70%, transparent);
    box-shadow:
      0 16px 40px -14px var(--shade),
      0 0 0 3px color-mix(in oklch, var(--magenta) 22%, transparent),
      0 0 26px 2px color-mix(in oklch, var(--magenta) 45%, transparent);
  }
  .wrap[data-tone="ask"] .ping { animation: orb-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite; }

  .spin {
    position: absolute;
    inset: -6px;
    border-radius: 999px;
    pointer-events: none;
    opacity: 0;
    background: conic-gradient(from 0deg, transparent 0 40%, color-mix(in oklch, var(--brand) 35%, transparent) 62%, var(--brand) 92%, transparent 100%);
    filter: drop-shadow(0 0 5px color-mix(in oklch, var(--brand) 80%, transparent));
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3.5px), #000 calc(100% - 3px));
    transition: opacity 240ms ease;
  }
  .wrap[data-tone="work"] .spin { opacity: 1; animation: orb-spin 1.1s linear infinite; }

  .ring { position: absolute; left: 50%; top: 50%; width: 72px; height: 72px; margin: -36px 0 0 -36px; transform: rotate(-90deg); pointer-events: none; overflow: visible; }
  .ring circle { stroke-width: 2.5; opacity: 0; transition: opacity 160ms ease; }
  .ring .track { stroke: color-mix(in oklch, var(--brand) 22%, transparent); }
  .ring .count { stroke: var(--brand); stroke-dasharray: ${RING}; stroke-dashoffset: 0; filter: drop-shadow(0 0 4px color-mix(in oklch, var(--brand) 70%, transparent)); }
  .wrap.counting .ring circle { opacity: 1; }
  .wrap.counting .ring .count { animation: orb-drain ${AUTO_SEND_MS}ms linear forwards; }

  .status {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 11px;
    height: 11px;
    border-radius: 999px;
    border: 2px solid var(--ground2);
    background: var(--inkFaint);
    display: none;
  }
  .wrap[data-link="pending"] .status { display: block; background: var(--amber); animation: orb-pulse 1.4s ease-in-out infinite; }
  .wrap[data-link="off"] .status { display: block; }
  .wrap[data-tone="ask"] .status { display: block; background: var(--ember); box-shadow: 0 0 8px 1px color-mix(in oklch, var(--ember) 70%, transparent); animation: none; }

  .keycap {
    position: absolute;
    left: 50%;
    bottom: 5px;
    translate: -50% 0;
    display: none;
    min-width: 16px;
    padding: 0 3px;
    border-radius: 4px;
    border: 1px solid var(--line);
    background: var(--ground);
    color: var(--inkDim);
    font: 600 8.5px/12px ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
    transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
  }
  .wrap.push-to-talk .keycap { display: block; }
  .wrap.push-to-talk .face { translate: 0 -4px; }
  .wrap.holding .orb {
    transform: scale(1.06);
    border-color: color-mix(in oklch, var(--magenta) 75%, transparent);
    box-shadow:
      0 16px 40px -14px var(--shade),
      0 0 0 3px color-mix(in oklch, var(--magenta) 25%, transparent),
      0 0 26px 2px color-mix(in oklch, var(--magenta) 45%, transparent);
  }
  .wrap.holding .keycap { background: var(--magenta); border-color: var(--magenta); color: var(--ground); }

  .halo {
    position: absolute;
    left: 50%;
    top: 50%;
    width: calc(var(--halo, 120px) * 2);
    height: calc(var(--halo, 120px) * 2);
    margin: calc(var(--halo, 120px) * -1) 0 0 calc(var(--halo, 120px) * -1);
    border-radius: 999px;
    pointer-events: none;
  }
  .wrap.open .halo { pointer-events: auto; }

  .item {
    all: unset;
    position: absolute;
    left: 50%;
    top: 50%;
    width: ${MENU_ITEM}px;
    height: ${MENU_ITEM}px;
    margin: -${MENU_ITEM / 2}px 0 0 -${MENU_ITEM / 2}px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    cursor: pointer;
    color: var(--inkDim);
    border: 1px solid var(--line);
    background: var(--ground2);
    box-shadow: 0 10px 26px -12px var(--shade), 0 0 0 1px rgb(0 0 0 / 18%);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(0, 0) scale(0.35);
    transition:
      transform 260ms ease-in calc(var(--r, 0) * 28ms),
      opacity 200ms ease calc(var(--r, 0) * 28ms),
      visibility 0s linear 360ms,
      background-color 150ms ease, color 150ms ease, border-color 150ms ease;
  }
  .item svg { width: 17px; height: 17px; }
  .wrap.open .item {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translate(var(--x, 0), var(--y, 0)) scale(1);
    transition:
      transform 460ms var(--spring) calc(var(--i, 0) * 60ms),
      opacity 220ms ease calc(var(--i, 0) * 60ms),
      visibility 0s,
      background-color 150ms ease, color 150ms ease, border-color 150ms ease;
  }
  .item:hover, .item:focus-visible { color: var(--ink); background: var(--surface); border-color: color-mix(in oklch, var(--brand) 40%, var(--line)); outline: none; }
  .item.on { color: var(--ember); border-color: color-mix(in oklch, var(--ember) 45%, transparent); background: color-mix(in oklch, var(--ember) 12%, var(--ground2)); }
  .item.busy svg { animation: orb-pulse 1.1s ease-in-out infinite; }
  .item .badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--brand);
    color: var(--ground);
    font: 700 9px/16px ui-monospace, SFMono-Regular, Menlo, monospace;
    text-align: center;
    display: none;
  }
  .item .badge.shown { display: block; }
  .tip {
    position: absolute;
    padding: 5px 9px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--ground2);
    color: var(--ink);
    font: 500 11px/1.2 var(--sans);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.94);
    transition: opacity 140ms ease, transform 180ms var(--ease);
    box-shadow: 0 10px 24px -12px var(--shade);
  }
  .item[data-tip="top"] .tip { bottom: calc(100% + 8px); left: 50%; translate: -50% 0; }
  .item[data-tip="bottom"] .tip { top: calc(100% + 8px); left: 50%; translate: -50% 0; }
  .item[data-tip="left"] .tip { right: calc(100% + 8px); top: 50%; translate: 0 -50%; }
  .item[data-tip="right"] .tip { left: calc(100% + 8px); top: 50%; translate: 0 -50%; }
  .item:hover .tip, .item:focus-visible .tip { opacity: 1; transform: none; }

  .caption {
    position: fixed;
    z-index: 2147483646;
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: max-content;
    max-width: min(360px, calc(100vw - 24px));
    padding: 10px 13px 11px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in oklch, var(--ground2) 94%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    backdrop-filter: blur(14px) saturate(1.2);
    box-shadow: 0 16px 40px -16px var(--shade), 0 0 0 1px rgb(0 0 0 / 20%);
    pointer-events: none;
    animation: orb-caption-in 260ms var(--ease) both;
    transition: opacity 200ms ease, left 260ms var(--ease), top 260ms var(--ease);
  }
  .caption.dragged { transition: opacity 200ms ease; }
  .caption[hidden] { display: none; }
  .caption.leaving { opacity: 0; }
  .caption[data-side="bottom"] .chips { order: -1; }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 9.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--tone, var(--inkFaint));
  }
  .label::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 8px 1px color-mix(in oklch, currentColor 70%, transparent);
  }
  .label:empty { display: none; }
  .caption[data-kind="speech"] { --tone: var(--magenta); }
  .caption[data-kind="sent"], .caption[data-kind="reply"] { --tone: var(--brand); }
  .caption[data-kind="error"] { --tone: var(--amber); }
  .caption[data-kind="ask"] { --tone: var(--ember); border-color: color-mix(in oklch, var(--ember) 40%, var(--line)); }
  .words {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-end;
    column-gap: 0.28em;
    max-height: calc(1.45em * 4);
    overflow: hidden;
    font: 400 14px/1.45 var(--sans);
    color: var(--ink);
  }
  .words:empty { display: none; }
  .words.overflow { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 1.6em); mask-image: linear-gradient(to bottom, transparent, #000 1.6em); }
  .caption[data-kind="hint"] .words { font-size: 12.5px; color: var(--inkDim); }
  .caption[data-kind="sent"] .words { color: var(--brand); }
  .caption[data-kind="error"] .words { color: color-mix(in oklch, var(--amber) 70%, var(--ink)); }
  .tok { display: inline-block; animation: orb-token 420ms var(--ease) both; }
  .tok.interim { color: var(--inkDim); }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; pointer-events: auto; }
  .chips:empty { display: none; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 240px;
    height: 22px;
    padding: 0 3px 0 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in oklch, var(--ember) 40%, transparent);
    background: color-mix(in oklch, var(--ember) 10%, transparent);
    color: var(--ink);
    font: 500 11px/1 var(--sans);
  }
  .chip svg { width: 12px; height: 12px; flex: none; color: var(--ember); }
  .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip button {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    color: var(--inkFaint);
    cursor: pointer;
  }
  .chip button:hover { background: var(--surface); color: var(--ink); }
  .chip button svg { width: 10px; height: 10px; color: inherit; }

  .pop {
    position: fixed;
    z-index: 2147483647;
    width: min(360px, calc(100vw - 24px));
    padding: 12px 12px 10px;
    border: 1px solid color-mix(in oklch, var(--ember) 45%, var(--line));
    border-radius: 14px;
    background: var(--ground2);
    box-shadow: 0 22px 50px -18px var(--shade), 0 0 0 1px rgb(0 0 0 / 22%), 0 0 30px -12px color-mix(in oklch, var(--ember) 50%, transparent);
    animation: orb-pop-in 280ms var(--ease) both;
  }
  .pop[hidden] { display: none; }
  .pop[data-side="top"] { transform-origin: var(--arrow) 100%; }
  .pop[data-side="bottom"] { transform-origin: var(--arrow) 0; }
  .pop[data-side="left"] { transform-origin: 100% var(--arrow); }
  .pop[data-side="right"] { transform-origin: 0 var(--arrow); }
  .arrow {
    position: absolute;
    width: 12px;
    height: 12px;
    background: var(--ground2);
    border: 1px solid color-mix(in oklch, var(--ember) 45%, var(--line));
    transform: rotate(45deg);
  }
  .pop[data-side="top"] .arrow { bottom: -7px; left: calc(var(--arrow) - 6px); border-top: 0; border-left: 0; }
  .pop[data-side="bottom"] .arrow { top: -7px; left: calc(var(--arrow) - 6px); border-bottom: 0; border-right: 0; }
  .pop[data-side="left"] .arrow { right: -7px; top: calc(var(--arrow) - 6px); border-bottom: 0; border-left: 0; }
  .pop[data-side="right"] .arrow { left: -7px; top: calc(var(--arrow) - 6px); border-top: 0; border-right: 0; }
  .pop-head { display: flex; align-items: center; gap: 8px; }
  .pop-head svg { width: 16px; height: 16px; flex: none; color: var(--ember); }
  .pop-title { font: 600 13px/1.35 var(--sans); color: var(--ink); }
  .pop-site { margin: 3px 0 0 24px; font: 500 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--inkFaint); }
  .pop-detail {
    margin-top: 9px;
    padding: 7px 9px;
    border-radius: 8px;
    background: color-mix(in oklch, var(--ground) 70%, transparent);
    border: 1px solid var(--line);
    font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--inkDim);
    overflow-wrap: anywhere;
  }
  .pop-purpose { margin-top: 9px; font: 12px/1.45 var(--sans); color: var(--ink); }
  .pop-code {
    margin-top: 7px;
    max-height: 160px;
    overflow: auto;
    padding: 8px 9px;
    border-radius: 8px;
    background: color-mix(in oklch, var(--ground) 80%, transparent);
    border: 1px solid var(--line);
    font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--inkDim);
    white-space: pre;
    tab-size: 2;
  }
  .pop-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 11px; }
  .btn {
    all: unset;
    height: 28px;
    padding: 0 11px;
    border-radius: 8px;
    font: 500 12px/28px var(--sans);
    color: var(--inkDim);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 150ms ease, color 150ms ease;
  }
  .btn:hover, .btn:focus-visible { background: var(--surface); color: var(--ink); outline: none; }
  .btn.primary { background: var(--brand); color: var(--ground); font-weight: 600; }
  .btn.primary:hover, .btn.primary:focus-visible { background: color-mix(in oklch, var(--brand) 86%, var(--ink)); color: var(--ground); }

  @keyframes orb-rise {
    from { opacity: 0; transform: translateY(70px) scale(0.4); }
    60% { opacity: 1; }
  }
  @keyframes orb-fade { from { opacity: 0; transform: scale(0.9); } }
  @keyframes orb-think {
    0%, 70%, 100% { opacity: 0.25; transform: translateY(0); }
    35% { opacity: 1; transform: translateY(-2px); }
  }
  @keyframes orb-ping { 0% { opacity: 0.9; transform: scale(1); } 75%, 100% { opacity: 0; transform: scale(1.75); } }
  @keyframes orb-spin { to { transform: rotate(360deg); } }
  @keyframes orb-drain { to { stroke-dashoffset: ${RING}; } }
  @keyframes orb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes orb-breathe {
    0%, 100% { border-color: color-mix(in oklch, var(--magenta) 22%, var(--line)); }
    50% { border-color: color-mix(in oklch, var(--magenta) 55%, var(--line)); }
  }
  @keyframes orb-glow {
    0%, 100% { box-shadow: 0 16px 40px -14px var(--shade), 0 0 0 1px rgb(0 0 0 / 22%), 0 6px 26px -10px color-mix(in oklch, var(--brand) 55%, transparent); }
    50% { box-shadow: 0 16px 40px -14px var(--shade), 0 0 0 1px rgb(0 0 0 / 22%), 0 0 30px 0 color-mix(in oklch, var(--brand) 55%, transparent); }
  }
  @keyframes orb-token {
    from { opacity: 0; filter: blur(4px); transform: translateY(3px); }
    to { opacity: 1; filter: blur(0); transform: none; }
  }
  @keyframes orb-caption-in { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
  @keyframes orb-pop-in { from { opacity: 0; transform: scale(0.92); } }

  @media (prefers-reduced-motion: reduce) {
    .wrap, .wrap *, .caption, .caption *, .pop { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
    .wrap.counting .ring .count { animation-duration: ${AUTO_SEND_MS}ms !important; }
  }
  @media print { .layer { display: none; } }
`;
