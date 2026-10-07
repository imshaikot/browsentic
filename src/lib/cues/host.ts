import { browser } from 'wxt/browser';
import { resolveTarget } from '@/lib/actions/page/dom';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { RAIL_PALETTES, RAIL_TONES } from '@/lib/rail/events';
import type { ThemeId } from '@/lib/settings/theme';
import { CUE_FADE_MS, CUE_HOST_ID, CUE_LINGER_MS, isCueCommand, type CueAnchor, type CuePlan } from './events';
import { cueLabel } from './label';
import { CUE_GLOW, HOST_STYLE, STYLES } from './styles';

export { CUE_CHANNEL, CUE_HOST_ID } from './events';

const RING_PAD = 4;
const POINT_SIZE = 28;
const CHIP_GAP = 6;
const CHIP_HEIGHT = 24;
const EDGE_CHIP_TOP = 12;
const VIEW_MARGIN = 8;
const RESOLVE_EVERY_MS = 250;
const LIVE_LIMIT_MS = 60_000;
const PAINT_WAIT_MS = 100;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Mark {
  anchor: CueAnchor;
  element: Element | null;
  ring: HTMLElement;
}

interface Cue {
  id: string;
  plan: CuePlan;
  node: HTMLElement;
  edge: HTMLElement;
  chip: HTMLElement;
  marks: Mark[];
  live: boolean;
  resolvedAt: number;
  timers: ReturnType<typeof setTimeout>[];
}

interface Layer {
  alive: () => boolean;
  show: (id: string, plan: CuePlan, theme: ThemeId) => void;
  settle: (id: string, ok: boolean) => void;
  quench: () => void;
}

/**
 * Where the agent is acting, drawn into the frame it acts in. The page gets one element on
 * its first cue and never another change: every ring, caption and fade lives in a closed
 * shadow root, nothing in it takes a pointer, and nothing here focuses or scrolls the page.
 */
export function exposeCues(): void {
  let layer: Layer | null = null;

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isCueCommand(message)) return;
    if (message.op === 'settle') {
      layer?.settle(message.id, message.ok);
      sendResponse({ ok: true });
      return;
    }
    if (message.op === 'show') {
      if (!layer?.alive()) layer = mountLayer();
      layer?.show(message.id, message.plan, message.theme);
    } else layer?.quench();
    void painted().then(() => sendResponse({ ok: true }));
    return true;
  });

  document.getElementById(CUE_HOST_ID)?.remove();
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) layer?.quench();
  });
}

function painted(): Promise<void> {
  if (document.visibilityState === 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PAINT_WAIT_MS);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

function mountLayer(): Layer | null {
  if (!document.documentElement) return null;
  const host = document.createElement('div');
  host.id = CUE_HOST_ID;
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  host.setAttribute('aria-hidden', 'true');
  const raisable = typeof host.showPopover === 'function';
  if (raisable) host.setAttribute('popover', 'manual');
  host.style.cssText = HOST_STYLE;
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLES}</style><div class="layer"></div>`;
  const surface = root.querySelector<HTMLElement>('.layer')!;
  document.documentElement.append(host);

  const cues = new Map<string, Cue>();
  let frame = 0;

  function show(id: string, plan: CuePlan, theme: ThemeId): void {
    paintTheme(theme);
    for (const other of cues.values()) fade(other);

    const node = part('cue');
    const edge = part('edge hidden');
    const chip = part('chip hidden');
    const marks = plan.anchors.map((anchor) => ({
      anchor,
      element: null,
      ring: part('point' in anchor ? 'ring point hidden' : 'ring hidden'),
    }));
    node.append(edge, ...marks.map((mark) => mark.ring), chip);
    surface.append(node);

    const cue: Cue = { id, plan, node, edge, chip, marks, live: true, resolvedAt: 0, timers: [] };
    cues.set(id, cue);
    cue.timers.push(setTimeout(() => fade(cue), LIVE_LIMIT_MS));
    resolve(cue);
    raise();
    draw(cue);
    track();
  }

  function settle(id: string, ok: boolean): void {
    const cue = cues.get(id);
    if (!cue?.live) return;
    cue.live = false;
    cue.node.classList.add(ok ? 'done' : 'failed');
    cue.timers.push(setTimeout(() => fade(cue), CUE_LINGER_MS));
  }

  function fade(cue: Cue): void {
    if (cue.node.classList.contains('out')) return;
    cue.live = false;
    cue.node.classList.add('out');
    cue.timers.push(setTimeout(() => drop(cue), CUE_FADE_MS));
  }

  function drop(cue: Cue): void {
    for (const timer of cue.timers) clearTimeout(timer);
    cue.node.remove();
    cues.delete(cue.id);
    if (!cues.size) lower();
  }

  function quench(): void {
    for (const cue of [...cues.values()]) drop(cue);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function paintTheme(theme: ThemeId): void {
    const palette = RAIL_PALETTES[theme];
    surface.style.setProperty('--brand', palette.brand);
    surface.style.setProperty('--ground2', palette.ground2);
    surface.style.setProperty('--ink', palette.ink);
    surface.style.setProperty('--warn', RAIL_TONES[theme].warn);
    surface.style.setProperty('--glow', CUE_GLOW[theme]);
  }

  function resolve(cue: Cue): void {
    cue.resolvedAt = performance.now();
    for (const mark of cue.marks) {
      if (!mark.element?.isConnected) mark.element = locate(mark.anchor);
    }
    caption(cue);
  }

  function caption(cue: Cue): void {
    const named = cue.marks.find((mark) => mark.element)?.element;
    const verb = document.createElement('i');
    verb.textContent = cue.plan.verb;
    const rest = [cue.plan.detail ? ` ${cue.plan.detail}` : '', named ? ` · ${cueLabel(named)}` : ''].join('');
    cue.chip.replaceChildren(verb, rest);
  }

  function draw(cue: Cue): void {
    let anchored: Box | null = null;
    for (const mark of cue.marks) {
      const box = boxOf(mark);
      mark.ring.classList.toggle('hidden', !box);
      if (!box) continue;
      place(mark.ring, box);
      anchored ??= box;
    }
    cue.edge.classList.toggle('hidden', anchored !== null);
    placeChip(cue.chip, anchored);
  }

  function track(): void {
    if (frame) return;
    const tick = () => {
      frame = 0;
      if (!cues.size) return;
      const now = performance.now();
      for (const cue of cues.values()) {
        if (cue.live && now - cue.resolvedAt > RESOLVE_EVERY_MS && cue.marks.some(unplaced)) resolve(cue);
        draw(cue);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function raise(): void {
    if (!raisable) return;
    try {
      if (host.matches(':popover-open')) {
        if (!underTopLayer(host)) return;
        host.hidePopover();
      }
      host.showPopover();
    } catch {}
  }

  function lower(): void {
    if (!raisable) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
    } catch {}
  }

  return { alive: () => host.isConnected, show, settle, quench };
}

function part(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function underTopLayer(host: Element): boolean {
  if (document.fullscreenElement) return true;
  try {
    if (document.querySelector(':modal')) return true;
    return [...document.querySelectorAll(':popover-open')].some((open) => open !== host);
  } catch {
    return false;
  }
}

const unplaced = (mark: Mark): boolean => !('point' in mark.anchor) && !mark.element?.isConnected;

function locate(anchor: CueAnchor): Element | null {
  if ('point' in anchor) return null;
  if ('focused' in anchor) {
    const active = document.activeElement;
    return active && active !== document.body && active !== document.documentElement ? active : null;
  }
  try {
    return resolveTarget(anchor.target, { includeHidden: anchor.includeHidden });
  } catch {
    return null;
  }
}

function boxOf(mark: Mark): Box | null {
  if ('point' in mark.anchor) {
    const { x, y } = mark.anchor.point;
    return { x: x - POINT_SIZE / 2, y: y - POINT_SIZE / 2, w: POINT_SIZE, h: POINT_SIZE };
  }
  if (!mark.element?.isConnected) return null;
  const rect = mark.element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left - RING_PAD,
    y: rect.top - RING_PAD,
    w: rect.width + RING_PAD * 2,
    h: rect.height + RING_PAD * 2,
  };
}

function place(node: HTMLElement, box: Box): void {
  node.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
  node.style.width = `${Math.round(box.w)}px`;
  node.style.height = `${Math.round(box.h)}px`;
}

function placeChip(chip: HTMLElement, box: Box | null): void {
  chip.classList.remove('hidden');
  const view = { w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight };
  const width = chip.offsetWidth;
  const clampX = (x: number) => Math.min(Math.max(x, VIEW_MARGIN), Math.max(VIEW_MARGIN, view.w - width - VIEW_MARGIN));
  const clampY = (y: number) => Math.min(Math.max(y, VIEW_MARGIN), Math.max(VIEW_MARGIN, view.h - CHIP_HEIGHT - VIEW_MARGIN));

  if (!box) {
    chip.style.transform = `translate(${Math.round(clampX((view.w - width) / 2))}px, ${EDGE_CHIP_TOP}px)`;
    return;
  }
  const above = box.y - CHIP_HEIGHT - CHIP_GAP;
  const below = box.y + box.h + CHIP_GAP;
  const y = above >= VIEW_MARGIN ? above : below <= view.h - CHIP_HEIGHT - VIEW_MARGIN ? below : box.y + CHIP_GAP;
  chip.style.transform = `translate(${Math.round(clampX(box.x))}px, ${Math.round(clampY(y))}px)`;
}
