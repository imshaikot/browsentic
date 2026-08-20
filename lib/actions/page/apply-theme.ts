import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import {
  brightnessFor,
  invertColor,
  parseColor,
  relativeLuminance,
  toHex,
  WHITE,
  type FilterChain,
} from './color';
import {
  injectTheme,
  measureTheme,
  recordFilter,
  removeInjectedTheme,
  scanStyleSheets,
  type ThemeHook,
} from './theme';

const MAX_RULES = 20000;
const MAX_TOKENS = 40;
const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/;
const UNSAFE_VALUE = /[;{}<>\\]|@import|url\(|expression\(/i;
const DARK_TARGET = 0.05;
const LIGHT_TARGET = 0.92;
const TOLERANCE = 0.08;
const MEDIA = 'img, picture, video, canvas, svg, iframe, embed, object';
const UNINVERT = 'invert(1) hue-rotate(180deg)';

export const applyTheme = defineAction({
  name: 'page.applyTheme',
  description:
    'Retheme the page, or put it back. Prefers the page’s own terms — it switches on the dark/light hook its stylesheets ' +
    'already define (a ".dark" class, a [data-theme] attribute), sets color-scheme, and overrides the design tokens you name. ' +
    'Only when that leaves the page at the wrong luminance does it fall back to repainting through a CSS filter. ' +
    'Reports the measured background luminance and text contrast before and after, so the change can be checked rather than assumed. ' +
    'The filter fallback creates a containing block on <html>, which re-anchors position:fixed elements, and it re-inverts images ' +
    'so photos stay right way round. Nothing here survives a reload — call it again, or with mode "revert", to undo it.',
  input: z.object({
    mode: z
      .enum(['keep', 'dark', 'light', 'revert'])
      .default('keep')
      .describe(
        'Which way to push the page: "dark" or "light" retheme it, "revert" removes everything Browsentic applied and ' +
          'restores the page’s own theme, "keep" leaves the light/dark decision alone and applies only the colours below',
      ),
    targetLuminance: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Relative luminance to bring the page background to, 0 black to 1 white, as reported by page.readTheme. ' +
          'Overrides the luminance "dark" and "light" imply. Reached by filtering, so it repaints images and text alike',
      ),
    background: z
      .string()
      .optional()
      .describe('CSS colour for the page background, e.g. "#0f172a" or "rgb(15 23 42)"; suppresses the luminance a mode would imply'),
    text: z.string().optional().describe('CSS colour for body text; elements that set their own colour keep it'),
    accent: z.string().optional().describe('CSS colour for links and form-control accents'),
    tokens: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'CSS custom properties to override on :root, e.g. {"--background": "#0f172a"}. Names come from page.readTheme’s ' +
          'tokens — this is the cleanest way to retheme a page that is built on design tokens, because its own rules do the work',
      ),
    saturation: z
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe('Colour intensity multiplier: 0 greyscale, 1 unchanged, above 1 more vivid'),
    contrast: z
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe('Contrast multiplier: 1 unchanged, above 1 pushes lights and darks apart'),
    transitionMs: z
      .number()
      .int()
      .nonnegative()
      .max(2000)
      .default(200)
      .describe('How long the page takes to cross-fade into the new theme; 0 switches instantly'),
  }),
  execute({ mode, targetLuminance, background, text, accent, tokens, saturation, contrast, transitionMs }) {
    const colors = {
      background: asColor(background, 'background'),
      text: asColor(text, 'text'),
      accent: asColor(accent, 'accent'),
    };
    const overrides = tokenOverrides(tokens);
    const adjusts = saturation !== undefined || contrast !== undefined;
    if (mode === 'keep' && targetLuminance === undefined && !adjusts && !overrides.length && !Object.values(colors).some(Boolean)) {
      throw new ActionError(
        'Nothing to apply — pass a "mode", a "targetLuminance", a colour, or "tokens".',
        'INVALID_INPUT',
      );
    }

    const replaced = removeInjectedTheme();
    const before = measureTheme();
    if (mode === 'revert') return { reverted: replaced, theme: before };

    const hook = mode === 'dark' || mode === 'light' ? bestHook(mode) : undefined;
    const style = injectTheme(baseCss({ mode, colors, overrides, transitionMs }), hook);
    const settled = measureTheme();

    const target = targetLuminance ?? (colors.background ? undefined : impliedTarget(mode, settled.luminance));
    const chain = filterChain(target, settled.background, saturation, contrast);
    if (chain) {
      style.textContent += `\n${filterCss(chain, settled.background, transitionMs)}`;
      recordFilter(style, chain);
    }

    const after = measureTheme();
    return {
      replaced,
      strategy: chain ? 'filter' : hook || mode !== 'keep' ? 'stylesheet' : 'colors',
      applied: {
        mode,
        hook,
        ...colors,
        tokens: overrides.length ? overrides.map(([name]) => name) : undefined,
        filter: chain ? filterFunctions(chain).join(' ') : undefined,
        targetLuminance: target,
      },
      css: (style.textContent ?? '').slice(0, 4000),
      before,
      after,
      ...(target === undefined ? {} : { reachedTarget: Math.abs(after.luminance - target) <= TOLERANCE }),
    };
  },
});

function asColor(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const color = parseColor(value);
  if (!color) {
    throw new ActionError(
      `"${field}" is not a colour this browser understands — pass something like "#0f172a", "rgb(15 23 42)" or "midnightblue".`,
      'INVALID_INPUT',
    );
  }
  return toHex(color);
}

function tokenOverrides(tokens: Record<string, string> | undefined): [string, string][] {
  const entries = Object.entries(tokens ?? {});
  if (entries.length > MAX_TOKENS) {
    throw new ActionError(
      `Too many tokens — ${entries.length} given and ${MAX_TOKENS} is the limit. Override only the ones that carry the theme.`,
      'INVALID_INPUT',
    );
  }
  return entries.map(([name, value]) => {
    if (!TOKEN_NAME.test(name)) {
      throw new ActionError(`"${name}" is not a custom property — names look like "--brand-500".`, 'INVALID_INPUT');
    }
    const trimmed = value.trim();
    if (!trimmed || UNSAFE_VALUE.test(trimmed)) {
      throw new ActionError(
        `The value for "${name}" is not a plain CSS value — it cannot be empty or carry ";", "{", "}", "\\" or "url(".`,
        'INVALID_INPUT',
      );
    }
    return [name, trimmed];
  });
}

function bestHook(scheme: 'dark' | 'light'): ThemeHook | undefined {
  return scanStyleSheets(MAX_RULES)
    .hooks.filter((hook) => hook.scheme === scheme)
    .sort((one, other) => rankHook(one) - rankHook(other))[0];
}

function rankHook(hook: ThemeHook): number {
  if (hook.kind === 'attribute') return hook.name === 'data-theme' ? 0 : 1;
  return hook.name.toLowerCase() === hook.scheme ? 2 : 3;
}

interface Plan {
  mode: 'keep' | 'dark' | 'light';
  colors: { background?: string; text?: string; accent?: string };
  overrides: [string, string][];
  transitionMs: number;
}

function baseCss({ mode, colors, overrides, transitionMs }: Plan): string {
  const rules: string[] = [];
  if (mode !== 'keep') rules.push(`:root { color-scheme: ${mode}; }`);
  if (overrides.length) {
    rules.push(`:root { ${overrides.map(([name, value]) => `${name}: ${value};`).join(' ')} }`);
  }
  if (colors.background) rules.push(`html, body { background-color: ${colors.background} !important; }`);
  if (colors.text) rules.push(`html, body { color: ${colors.text} !important; }`);
  if (colors.accent) {
    rules.push(`:root { accent-color: ${colors.accent} !important; }`, `a { color: ${colors.accent} !important; }`);
  }
  if (transitionMs > 0) {
    rules.push(
      `html, body { transition: background-color ${transitionMs}ms linear, color ${transitionMs}ms linear, filter ${transitionMs}ms linear; }`,
    );
  }
  return rules.join('\n');
}

function impliedTarget(mode: 'keep' | 'dark' | 'light', luminance: number): number | undefined {
  if (mode === 'dark') return luminance > 0.5 ? DARK_TARGET : undefined;
  if (mode === 'light') return luminance < 0.5 ? LIGHT_TARGET : undefined;
  return undefined;
}

function filterChain(
  target: number | undefined,
  background: string,
  saturate: number | undefined,
  contrast: number | undefined,
): FilterChain | undefined {
  const current = parseColor(background) ?? WHITE;
  const luminance = relativeLuminance(current);
  const invert = target !== undefined && (target < 0.5) !== (luminance < 0.5);
  const reachable = invert ? relativeLuminance(invertColor(current)) : luminance;
  const brightness =
    target === undefined || reachable <= 0.004
      ? 1
      : brightnessFor(invert ? invertColor(current) : current, target);
  if (!invert && brightness === 1 && saturate === undefined && contrast === undefined) return undefined;
  return { invert, brightness, saturate, contrast };
}

function filterFunctions({ invert, brightness, saturate, contrast }: FilterChain): string[] {
  return [
    invert ? UNINVERT : '',
    brightness === 1 ? '' : `brightness(${brightness})`,
    saturate === undefined ? '' : `saturate(${saturate})`,
    contrast === undefined ? '' : `contrast(${contrast})`,
  ].filter(Boolean);
}

function filterCss(chain: FilterChain, background: string, transitionMs: number): string {
  const rules = [
    `html { background-color: ${background}; filter: ${filterFunctions(chain).join(' ')}; }`,
  ];
  if (chain.invert) rules.push(`${MEDIA} { filter: ${UNINVERT}; }`);
  if (transitionMs > 0) rules.push(`${MEDIA} { transition: filter ${transitionMs}ms linear; }`);
  return rules.join('\n');
}
