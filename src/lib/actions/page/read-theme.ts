import { z } from 'zod';
import { defineAction } from '../core';
import {
  contrastRatio,
  effectiveBackground,
  effectiveForeground,
  parseColor,
  relativeLuminance,
  round,
  toHex,
  type Rgb,
} from './color';
import { computedRole, cssPath } from './dom';
import { asRendered, measureTheme, resolveTokens, scanStyleSheets } from './theme';

const MAX_RULES = 20000;
const MIN_SURFACE_SHARE = 0.02;

type Shown = (color: Rgb) => Rgb;

interface Sample {
  el: HTMLElement;
  style: CSSStyleDeclaration;
  area: number;
  ownText: boolean;
}

interface Swatch {
  color: string;
  luminance: number;
  count: number;
  area: number;
}

interface Surface {
  selector: string;
  tag: string;
  role?: string;
  background: string;
  text: string;
  luminance: number;
  contrast: number;
  area: number;
  children: Surface[];
}

export const readTheme = defineAction({
  name: 'page.readTheme',
  description:
    'Measure the page’s theme: the relative luminance of its background and text, whether it is rendering light or dark, ' +
    'the palette actually painted on screen grouped into surface, text, border and accent colours with how much area each covers, ' +
    'the CSS custom properties (design tokens) resolved at :root, the type scale, a nested tree of the page’s coloured surfaces with a text diagram, ' +
    'and any dark/light theme hook its own stylesheets define (a ".dark" class or a [data-theme] attribute). ' +
    'Read this before page.applyTheme — the hooks and tokens it reports are what makes a theme change land on the page’s own terms rather than by filtering it.',
  input: z.object({
    maxScan: z
      .number()
      .int()
      .positive()
      .max(4000)
      .default(1200)
      .describe('Elements to measure; a larger document is sampled at an even stride across it'),
    maxPerGroup: z
      .number()
      .int()
      .positive()
      .max(30)
      .default(8)
      .describe('Colours listed per palette group, widest coverage first'),
    maxTokens: z
      .number()
      .int()
      .nonnegative()
      .max(200)
      .default(40)
      .describe('CSS custom properties listed, sorted by name; 0 skips them'),
    maxSurfaces: z
      .number()
      .int()
      .positive()
      .max(60)
      .default(20)
      .describe('Coloured surfaces kept in the surface tree, largest region first'),
  }),
  execute({ maxScan, maxPerGroup, maxTokens, maxSurfaces }) {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const { samples, scanned, total } = collect(maxScan);
    const shown = asRendered();
    const measured = measureTheme();
    const sheets = scanStyleSheets(MAX_RULES);

    return {
      url: location.href,
      scheme: {
        declared: rootStyle.colorScheme || 'normal',
        prefers: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        resolved: measured.colorScheme,
        hooks: sheets.hooks,
      },
      luminance: {
        background: measured.luminance,
        text: round(relativeLuminance(parseColor(measured.text) ?? { r: 0, g: 0, b: 0, a: 1 }), 4),
        mean: meanLuminance(samples, shown),
        mode: measured.luminance < 0.5 ? 'dark' : 'light',
      },
      colors: {
        background: measured.background,
        text: measured.text,
        contrast: measured.contrast,
      },
      palette: palette(samples, maxPerGroup, shown),
      tokens: maxTokens === 0 ? { total: sheets.properties.length, listed: [] } : resolveTokens(sheets.properties, maxTokens),
      typography: typography(samples),
      stylesheets: { ...sheets.sheets, rules: sheets.rules, truncated: sheets.truncated },
      surfaces: surfaces(samples, maxSurfaces, shown),
      sampled: { elements: samples.length, scanned, of: total },
    };
  },
});

function collect(maxScan: number): { samples: Sample[]; scanned: number; total: number } {
  const all = [...document.querySelectorAll<HTMLElement>('body, body *')];
  const stride = Math.max(1, Math.ceil(all.length / maxScan));
  const samples: Sample[] = [];
  let scanned = 0;
  for (let index = 0; index < all.length; index += stride) {
    const el = all[index];
    scanned += 1;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    samples.push({ el, style, area: Math.round(rect.width * rect.height), ownText: hasOwnText(el) });
  }
  return { samples, scanned, total: all.length };
}

function hasOwnText(el: Element): boolean {
  return [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );
}

function meanLuminance(samples: Sample[], shown: Shown): number {
  const painted = samples
    .map((sample) => ({ area: sample.area, color: rendered(sample.style.backgroundColor, shown) }))
    .filter((entry): entry is { area: number; color: Rgb } => !!entry.color && entry.color.a > 0.5);
  const area = painted.reduce((sum, entry) => sum + entry.area, 0);
  if (area === 0) return 0;
  return round(
    painted.reduce((sum, entry) => sum + relativeLuminance(entry.color) * entry.area, 0) / area,
    4,
  );
}

function rendered(value: string, shown: Shown): Rgb | null {
  const color = parseColor(value);
  return color && color.a > 0 ? shown(color) : color;
}

function palette(samples: Sample[], cap: number, shown: Shown) {
  const groups = {
    surface: new Map<string, Swatch>(),
    text: new Map<string, Swatch>(),
    border: new Map<string, Swatch>(),
    accent: new Map<string, Swatch>(),
  };
  for (const sample of samples) {
    add(groups.surface, sample.style.backgroundColor, sample.area, shown);
    if (sample.ownText) add(groups.text, sample.style.color, sample.area, shown);
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      const width = parseFloat(sample.style[`border${side}Width`]);
      if (width > 0 && sample.style[`border${side}Style`] !== 'none') {
        add(groups.border, sample.style[`border${side}Color`], sample.area, shown);
      }
    }
    if (sample.el.matches('a[href]')) add(groups.accent, sample.style.color, sample.area, shown);
    if (sample.el.matches('button,[role="button"],input[type="submit"]')) {
      add(groups.accent, sample.style.backgroundColor, sample.area, shown);
    }
  }
  return {
    surface: rank(groups.surface, cap),
    text: rank(groups.text, cap),
    border: rank(groups.border, cap),
    accent: rank(groups.accent, cap),
  };
}

function add(group: Map<string, Swatch>, value: string, area: number, shown: Shown) {
  const color = rendered(value, shown);
  if (!color || color.a === 0) return;
  const hex = toHex(color);
  const swatch = group.get(hex) ?? {
    color: hex,
    luminance: round(relativeLuminance(color), 3),
    count: 0,
    area: 0,
  };
  swatch.count += 1;
  swatch.area += area;
  group.set(hex, swatch);
}

function rank(group: Map<string, Swatch>, cap: number): Swatch[] {
  return [...group.values()]
    .sort((one, other) => other.area - one.area || other.count - one.count || (one.color < other.color ? -1 : 1))
    .slice(0, cap);
}

function typography(samples: Sample[]) {
  const body = document.body ?? document.documentElement;
  const base = getComputedStyle(body);
  const families = new Map<string, number>();
  const sizes = new Map<number, number>();
  for (const sample of samples) {
    if (!sample.ownText) continue;
    tally(families, firstFamily(sample.style.fontFamily));
    tally(sizes, Math.round(parseFloat(sample.style.fontSize)));
  }
  return {
    base: {
      family: firstFamily(base.fontFamily),
      sizePx: round(parseFloat(base.fontSize), 1),
      lineHeight: base.lineHeight,
      weight: base.fontWeight,
    },
    families: byCount(families).map(([family, count]) => ({ family, count })),
    sizes: byCount(sizes).map(([sizePx, count]) => ({ sizePx, count })),
  };
}

function firstFamily(value: string): string {
  return value.split(',')[0]?.replace(/["']/g, '').trim() || 'unknown';
}

function tally<T>(counts: Map<T, number>, key: T) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function byCount<T extends string | number>(counts: Map<T, number>): [T, number][] {
  return [...counts.entries()]
    .sort((one, other) => other[1] - one[1] || (one[0] < other[0] ? -1 : 1))
    .slice(0, 10);
}

function surfaces(samples: Sample[], cap: number, shown: Shown) {
  const minArea = innerWidth * innerHeight * MIN_SURFACE_SHARE;
  const painted = samples
    .filter((sample) => sample.area >= minArea && (parseColor(sample.style.backgroundColor)?.a ?? 0) > 0.05)
    .sort((one, other) => other.area - one.area)
    .slice(0, cap)
    .sort((one, other) => (one.el.compareDocumentPosition(other.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  const tree: Surface[] = [];
  const owners = new Map<HTMLElement, Surface>();
  for (const sample of painted) {
    const surface = describeSurface(sample, shown);
    owners.set(sample.el, surface);
    let ancestor = sample.el.parentElement;
    while (ancestor && !owners.has(ancestor)) ancestor = ancestor.parentElement;
    (ancestor ? owners.get(ancestor)!.children : tree).push(surface);
  }
  return { tree, diagram: renderDiagram(tree) };
}

function describeSurface({ el, area }: Sample, shown: Shown): Surface {
  const painted = effectiveBackground(el);
  const background = shown(painted);
  const text = shown(effectiveForeground(el, painted));
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    role: computedRole(el),
    background: toHex(background),
    text: toHex(text),
    luminance: round(relativeLuminance(background), 3),
    contrast: round(contrastRatio(text, background), 2),
    area,
    children: [],
  };
}

function renderDiagram(tree: Surface[]): string {
  const measured = measureTheme();
  const lines = [
    `page ${measured.background} · luminance ${measured.luminance} · text ${measured.text} · contrast ${measured.contrast}:1 · ${measured.colorScheme}`,
  ];
  const walk = (nodes: Surface[], indent: string) => {
    nodes.forEach((surface, index) => {
      const last = index === nodes.length - 1;
      const name = surface.role ? `${surface.tag}[${surface.role}]` : surface.tag;
      lines.push(
        `${indent}${last ? '└' : '├'} ${name} · ${surface.background} · L ${surface.luminance} · text ${surface.text} · ${surface.contrast}:1`,
      );
      walk(surface.children, indent + (last ? '  ' : '│ '));
    });
  };
  walk(tree, '');
  return lines.join('\n');
}
