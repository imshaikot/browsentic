import { z } from 'zod';
import { ActionError } from '../core';

export const targetSchema = z.object({
  selector: z.string().optional().describe('CSS selector for the element'),
  text: z.string().optional().describe('Case-insensitive visible text the element should contain'),
  role: z.string().optional().describe('Tag name or ARIA role to narrow matches, e.g. "button" or "link"'),
  nth: z.number().int().nonnegative().default(0).describe('Zero-based index when several elements match'),
});

export type Target = z.output<typeof targetSchema>;

const INTERACTIVE =
  'a,button,input,select,textarea,summary,label,h1,h2,h3,h4,h5,h6,[role],[tabindex],[contenteditable]';

const ROLE_TAGS: Record<string, string[]> = {
  link: ['a'],
  button: ['button'],
  textbox: ['input', 'textarea'],
  combobox: ['select'],
  checkbox: ['input'],
  radio: ['input'],
  heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
};

function matchesRole(el: Element, role: string): boolean {
  const wanted = role.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === wanted) return true;
  if (el.getAttribute('role')?.toLowerCase() === wanted) return true;
  return ROLE_TAGS[wanted]?.includes(tag) ?? false;
}

export function resolveTarget(
  target: Target,
  options: { includeHidden?: boolean } = {},
): HTMLElement {
  const { selector, text, role, nth } = target;
  if (!selector && !text) {
    throw new ActionError('A target needs a "selector" or "text"', 'INVALID_TARGET');
  }
  let pool = [...document.querySelectorAll<HTMLElement>(selector ?? INTERACTIVE)];
  if (role) pool = pool.filter((el) => matchesRole(el, role));
  if (text) {
    const needle = text.toLowerCase();
    pool = pool.filter((el) => accessibleText(el).toLowerCase().includes(needle));
    pool = pool.filter((el) => !pool.some((other) => other !== el && el.contains(other)));
  }
  if (!options.includeHidden) pool = pool.filter(isVisible);
  const element = pool[nth];
  if (!element) {
    throw new ActionError(
      `No element matches ${JSON.stringify(target)} (${pool.length} candidates)`,
      'TARGET_NOT_FOUND',
    );
  }
  return element;
}

export function accessibleText(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  if (el instanceof HTMLInputElement) {
    // Button-like inputs are named by their value, not a label or placeholder.
    if (el.type === 'submit' || el.type === 'button' || el.type === 'reset') {
      return el.value.trim() || el.type;
    }
    return fieldName(el);
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return fieldName(el);
  if (el instanceof HTMLImageElement) return el.alt.trim();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const img = el.querySelector('img[alt]');
  return img instanceof HTMLImageElement ? img.alt.trim() : '';
}

function fieldName(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const label = el.labels?.[0]?.textContent?.trim();
  return label || el.getAttribute('placeholder')?.trim() || el.name;
}

export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function cssPath(el: Element): string {
  const path: string[] = [];
  for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
    if (node.id) {
      path.unshift(`#${CSS.escape(node.id)}`);
      return path.join(' > ');
    }
    const tag = node.tagName.toLowerCase();
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((child) => child.tagName === node!.tagName)
      : [];
    path.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
  }
  return path.join(' > ');
}

export function documentBounds(el: Element) {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x + window.scrollX),
    y: Math.round(rect.y + window.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function describeElement(el: Element) {
  const text = accessibleText(el).slice(0, 80);
  return {
    tag: el.tagName.toLowerCase(),
    selector: cssPath(el),
    text: text || undefined,
    bounds: documentBounds(el),
  };
}
