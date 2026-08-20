import {
  applyFilters,
  contrastRatio,
  effectiveBackground,
  effectiveForeground,
  parseColor,
  relativeLuminance,
  resolvedScheme,
  round,
  toHex,
  type FilterChain,
  type Rgb,
} from './color';

export const THEME_STYLE_ID = 'browsentic-theme';

const ADDED_CLASS = 'data-browsentic-added-class';
const HOOK_ATTRIBUTE = 'data-browsentic-hook-attribute';
const HOOK_HOST = 'data-browsentic-hook-host';
const HOOK_FILTER = 'data-browsentic-filter';
const PREVIOUS_VALUE = 'data-browsentic-previous-value';

const CLASS_HOOK = /\.((?:theme-|mode-)?(dark|light)(?:-mode|-theme)?)(?![\w-])/i;
const ATTRIBUTE_HOOK = /\[([\w-]*(?:theme|mode|scheme))\s*[~|^$*]?=\s*["']?(dark|light)["']?\s*[is]?\]/i;

export interface ThemeHook {
  kind: 'class' | 'attribute';
  name: string;
  value?: string;
  scheme: 'dark' | 'light';
  host: 'root' | 'body';
  selector: string;
}

export interface SheetScan {
  sheets: { total: number; readable: number; crossOrigin: number; inline: number };
  rules: number;
  properties: string[];
  hooks: ThemeHook[];
  truncated: boolean;
}

export function scanStyleSheets(maxRules: number): SheetScan {
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
  const properties = new Set<string>();
  const hooks = new Map<string, ThemeHook>();
  const counts = { total: sheets.length, readable: 0, crossOrigin: 0, inline: 0 };
  let rules = 0;

  const visit = (rule: CSSRule) => {
    if (rules >= maxRules) return;
    rules += 1;
    if (rule instanceof CSSStyleRule) {
      for (const name of rule.style) if (name.startsWith('--')) properties.add(name);
      noteHooks(rule.selectorText, hooks);
      return;
    }
    if (rule instanceof CSSGroupingRule) for (const nested of rule.cssRules) visit(nested);
    if (rule instanceof CSSImportRule) for (const nested of readable(rule.styleSheet) ?? []) visit(nested);
  };

  for (const sheet of sheets) {
    if (!sheet.href) counts.inline += 1;
    const list = readable(sheet);
    if (!list) {
      counts.crossOrigin += 1;
      continue;
    }
    counts.readable += 1;
    for (const rule of list) visit(rule);
  }

  return {
    sheets: counts,
    rules,
    properties: [...properties],
    hooks: [...hooks.values()],
    truncated: rules >= maxRules,
  };
}

function readable(sheet: CSSStyleSheet | null): CSSRuleList | null {
  try {
    return sheet?.cssRules ?? null;
  } catch {
    return null;
  }
}

function noteHooks(selectorText: string, into: Map<string, ThemeHook>) {
  for (const part of selectorText.split(',')) {
    const selector = part.trim();
    const head = selector.split(/[\s>+~]+/)[0];
    const host = /^body\b/i.test(head) ? 'body' : 'root';
    const attribute = ATTRIBUTE_HOOK.exec(head);
    if (attribute) {
      const [, name, scheme] = attribute;
      remember(into, {
        kind: 'attribute',
        name: name.toLowerCase(),
        value: scheme.toLowerCase(),
        scheme: scheme.toLowerCase() as 'dark' | 'light',
        host,
        selector,
      });
      continue;
    }
    const className = CLASS_HOOK.exec(head);
    if (className) {
      const [, name, scheme] = className;
      remember(into, {
        kind: 'class',
        name,
        scheme: scheme.toLowerCase() as 'dark' | 'light',
        host,
        selector,
      });
    }
  }
}

function remember(into: Map<string, ThemeHook>, hook: ThemeHook) {
  into.set(`${hook.kind}:${hook.host}:${hook.name}:${hook.value ?? ''}`, hook);
}

export interface Token {
  name: string;
  value: string;
  color?: string;
  luminance?: number;
}

export function resolveTokens(names: string[], limit: number): { total: number; listed: Token[] } {
  const rootStyle = getComputedStyle(document.documentElement);
  const resolved = names
    .map((name) => ({ name, value: rootStyle.getPropertyValue(name).trim().slice(0, 120) }))
    .filter(({ value }) => value !== '')
    .sort((one, other) => (one.name < other.name ? -1 : 1));
  return { total: resolved.length, listed: resolved.slice(0, limit).map(describeToken) };
}

function describeToken({ name, value }: { name: string; value: string }): Token {
  const color = parseColor(value);
  if (!color || color.a === 0) return { name, value };
  return { name, value, color: toHex(color), luminance: round(relativeLuminance(color), 3) };
}

export function activeFilter(): FilterChain | undefined {
  const declared = document.getElementById(THEME_STYLE_ID)?.getAttribute(HOOK_FILTER);
  if (!declared) return undefined;
  try {
    return JSON.parse(declared) as FilterChain;
  } catch {
    return undefined;
  }
}

/**
 * A CSS filter repaints the page without touching any computed style, so every colour
 * read out of the CSSOM is the one underneath it. This maps a read colour to the one
 * actually on screen, and is the identity when Browsentic has not filtered the page.
 */
export function asRendered(): (color: Rgb) => Rgb {
  const chain = activeFilter();
  return chain ? (color) => applyFilters(color, chain) : (color) => color;
}

export function recordFilter(style: HTMLStyleElement, chain: FilterChain) {
  style.setAttribute(HOOK_FILTER, JSON.stringify(chain));
}

export interface ThemeMeasurement {
  colorScheme: 'light' | 'dark';
  background: string;
  text: string;
  luminance: number;
  contrast: number;
  filtered?: boolean;
}

export function measureTheme(): ThemeMeasurement {
  const surface = document.body ?? document.documentElement;
  const shown = asRendered();
  const painted = effectiveBackground(surface);
  const background = shown(painted);
  const text = shown(effectiveForeground(surface, painted));
  return {
    colorScheme: resolvedScheme(),
    background: toHex(background),
    text: toHex(text),
    luminance: round(relativeLuminance(background), 4),
    contrast: round(contrastRatio(text, background), 2),
    ...(activeFilter() ? { filtered: true } : {}),
  };
}

function hostElement(host: 'root' | 'body'): HTMLElement {
  return host === 'body' ? (document.body ?? document.documentElement) : document.documentElement;
}

export function removeInjectedTheme(): boolean {
  const style = document.getElementById(THEME_STYLE_ID);
  if (!style) return false;
  const host = hostElement(style.getAttribute(HOOK_HOST) === 'body' ? 'body' : 'root');
  const addedClass = style.getAttribute(ADDED_CLASS);
  if (addedClass) host.classList.remove(addedClass);
  const attribute = style.getAttribute(HOOK_ATTRIBUTE);
  if (attribute) {
    const previous = style.getAttribute(PREVIOUS_VALUE);
    if (previous === null) host.removeAttribute(attribute);
    else host.setAttribute(attribute, previous);
  }
  style.remove();
  return true;
}

export function injectTheme(css: string, hook?: ThemeHook): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = css;
  if (hook) applyHook(style, hook);
  document.documentElement.append(style);
  return style;
}

function applyHook(style: HTMLStyleElement, hook: ThemeHook) {
  const host = hostElement(hook.host);
  style.setAttribute(HOOK_HOST, hook.host);
  if (hook.kind === 'class') {
    if (host.classList.contains(hook.name)) return;
    host.classList.add(hook.name);
    style.setAttribute(ADDED_CLASS, hook.name);
    return;
  }
  const previous = host.getAttribute(hook.name);
  style.setAttribute(HOOK_ATTRIBUTE, hook.name);
  if (previous !== null) style.setAttribute(PREVIOUS_VALUE, previous);
  host.setAttribute(hook.name, hook.value ?? '');
}
