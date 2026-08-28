import { z } from 'zod';
import { defineAction } from '../core';
import { accessibleText, cssPath, documentBounds, isVisible } from './dom';

const PERCENT = /(\d{1,3}(?:\.\d+)?)\s?%/;
const SPINNER_CLASS = /spinner|loading|progress/i;
const TEXT_CLIP = 80;

interface Candidate {
  kind: 'progressbar' | 'progress-element' | 'percent-text' | 'spinner' | 'busy-region';
  selector: string;
  text?: string;
  value?: number;
  max?: number;
  percent?: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export const findProgress = defineAction({
  name: 'page.findProgress',
  description:
    'Scan the page for progress signals worth monitoring: progress bars, percent readouts, spinners and busy regions, each with a selector for page.startMonitor. ' +
    'An empty candidates list with no titlePercent means the page shows nothing measurable — ask the user what completion looks like instead of starting a monitor.',
  input: z.object({
    maxCandidates: z
      .number()
      .int()
      .positive()
      .max(30)
      .default(10)
      .describe('Cap on candidates returned, strongest signals first'),
  }),
  execute({ maxCandidates }) {
    const candidates: Candidate[] = [
      ...progressbars(),
      ...progressElements(),
      ...percentTexts(),
      ...spinners(),
      ...busyRegions(),
    ];
    const seen = new Set<string>();
    const unique = candidates.filter((candidate) => {
      if (seen.has(candidate.selector)) return false;
      seen.add(candidate.selector);
      return true;
    });
    const titleMatch = PERCENT.exec(document.title);
    return {
      candidates: unique.slice(0, maxCandidates),
      ...(titleMatch ? { titlePercent: clamp(parseFloat(titleMatch[1])) } : {}),
      url: location.href,
    };
  },
});

function progressbars(): Candidate[] {
  return visible('[role="progressbar"]').map((el) => {
    const now = parseFloat(el.getAttribute('aria-valuenow') ?? '');
    const min = parseFloat(el.getAttribute('aria-valuemin') ?? '0') || 0;
    const max = parseFloat(el.getAttribute('aria-valuemax') ?? '100') || 100;
    const percent = Number.isFinite(now) && max > min ? clamp(((now - min) / (max - min)) * 100) : undefined;
    return describe(el, 'progressbar', { value: Number.isFinite(now) ? now : undefined, max, percent });
  });
}

function progressElements(): Candidate[] {
  return visible('progress, meter').map((el) => {
    const bar = el as HTMLProgressElement | HTMLMeterElement;
    const percent = bar.max > 0 ? clamp((bar.value / bar.max) * 100) : undefined;
    return describe(el, 'progress-element', { value: bar.value, max: bar.max, percent });
  });
}

function percentTexts(): Candidate[] {
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  const blocks = new Set<HTMLElement>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!PERCENT.test(node.textContent ?? '')) continue;
    const block = blockAncestor(node.parentElement);
    if (block && isVisible(block)) blocks.add(block);
  }
  return [...blocks].map((el) => {
    const text = collapse(el.innerText ?? '');
    const percent = PERCENT.exec(text);
    return describe(el, 'percent-text', {
      text: text.slice(0, TEXT_CLIP),
      percent: percent ? clamp(parseFloat(percent[1])) : undefined,
    });
  });
}

function spinners(): Candidate[] {
  return visible('[class]')
    .filter((el) => SPINNER_CLASS.test(el.getAttribute('class') ?? '') && getComputedStyle(el).animationName !== 'none')
    .map((el) => describe(el, 'spinner', {}));
}

function busyRegions(): Candidate[] {
  return visible('[aria-busy="true"]').map((el) => describe(el, 'busy-region', {}));
}

function describe(el: HTMLElement, kind: Candidate['kind'], extra: Partial<Candidate>): Candidate {
  const text = extra.text ?? accessibleText(el).slice(0, TEXT_CLIP);
  return {
    kind,
    selector: cssPath(el),
    ...(text ? { text } : {}),
    ...(extra.value != null ? { value: extra.value } : {}),
    ...(extra.max != null ? { max: extra.max } : {}),
    ...(extra.percent != null ? { percent: extra.percent } : {}),
    bounds: documentBounds(el),
  };
}

function visible(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(isVisible);
}

function blockAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let node = el; node; node = node.parentElement) {
    if (getComputedStyle(node).display !== 'inline') return node;
  }
  return el;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clamp(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}
