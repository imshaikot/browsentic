import { z } from 'zod';
import { defineAction } from '../core';
import {
  contrastRatio,
  effectiveBackground,
  effectiveForeground,
  isLargeText,
  requiredRatio,
  round,
  toHex,
  type Rgb,
} from './color';
import { cssPath, documentBounds, isExposed, resolveTarget, targetSchema } from './dom';
import { asRendered } from './theme';

const TEXT_CLIP = 60;

interface Check {
  selector: string;
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  passes: boolean;
  fontSizePx: number;
  weight: number;
  large: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export const auditContrast = defineAction({
  name: 'page.auditContrast',
  description:
    'Score the readability of the page against WCAG contrast rules. Walks the visible text, resolves each run’s ' +
    'foreground against the real background painted behind it — blending translucent layers up the ancestor chain — ' +
    'and reports the ratio, the ratio the level requires, and whether it passes. ' +
    'The score is the share of sampled text runs that pass, so it is directly comparable before and after page.applyTheme.',
  input: z.object({
    target: targetSchema.optional().describe('Subtree to audit; defaults to the whole page'),
    level: z
      .enum(['AA', 'AAA'])
      .default('AA')
      .describe('WCAG level: AA needs 4.5:1 for body text and 3:1 for large text, AAA needs 7:1 and 4.5:1'),
    maxSamples: z
      .number()
      .int()
      .positive()
      .max(2000)
      .default(400)
      .describe('Text-bearing elements to check, in document order'),
    maxFailures: z
      .number()
      .int()
      .nonnegative()
      .max(200)
      .default(20)
      .describe('Failures listed, worst ratio first; the counts always cover everything sampled'),
  }),
  execute({ target, level, maxSamples, maxFailures }) {
    const root = target ? resolveTarget(target) : (document.body ?? document.documentElement);
    const checks = sampleText(root, level, maxSamples, asRendered());
    const failures = checks.filter((check) => !check.passes).sort((one, other) => one.ratio - other.ratio);
    const passed = checks.length - failures.length;

    return {
      url: location.href,
      level,
      required: { normalText: requiredRatio(false, level), largeText: requiredRatio(true, level) },
      ...(checks.length ? { score: Math.round((passed / checks.length) * 100) } : {}),
      summary: {
        sampled: checks.length,
        passed,
        failed: failures.length,
        worstRatio: checks.length ? Math.min(...checks.map((check) => check.ratio)) : undefined,
      },
      failures: failures.slice(0, maxFailures),
      source: cssPath(root),
    };
  },
});

function sampleText(
  root: Element,
  level: 'AA' | 'AAA',
  maxSamples: number,
  shown: (color: Rgb) => Rgb,
): Check[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  const checks: Check[] = [];
  for (let node = walker.nextNode(); node && checks.length < maxSamples; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el)) continue;
    seen.add(el);
    if (!isExposed(el)) continue;
    checks.push(evaluate(el, text, level, shown));
  }
  return checks;
}

function evaluate(el: HTMLElement, text: string, level: 'AA' | 'AAA', shown: (color: Rgb) => Rgb): Check {
  const style = getComputedStyle(el);
  const painted = effectiveBackground(el);
  const background = shown(painted);
  const foreground = shown(effectiveForeground(el, painted));
  const fontSizePx = round(parseFloat(style.fontSize), 1);
  const weight = Number(style.fontWeight) || 400;
  const large = isLargeText(fontSizePx, weight);
  const ratio = round(contrastRatio(foreground, background), 2);
  const required = requiredRatio(large, level);
  return {
    selector: cssPath(el),
    text: text.slice(0, TEXT_CLIP),
    foreground: toHex(foreground),
    background: toHex(background),
    ratio,
    required,
    passes: ratio >= required,
    fontSizePx,
    weight,
    large,
    bounds: documentBounds(el),
  };
}
