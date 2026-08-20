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

const ROLE_BY_INPUT_TYPE: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  file: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
};

const ROLE_BY_TAG: Record<string, string> = {
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  summary: 'button',
  option: 'option',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  form: 'form',
  dialog: 'dialog',
};

const VALUELESS_INPUT = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file']);

export function computedRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  if (el instanceof HTMLInputElement) return ROLE_BY_INPUT_TYPE[el.type] ?? 'textbox';
  if (el instanceof HTMLAnchorElement) return el.getAttribute('href') === null ? undefined : 'link';
  return ROLE_BY_TAG[el.tagName.toLowerCase()];
}

function matchesRole(el: Element, role: string): boolean {
  const wanted = role.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === wanted) return true;
  if (computedRole(el) === wanted) return true;
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

export function isExposed(el: Element): boolean {
  return isVisible(el) && !el.closest('[aria-hidden="true"],[inert]');
}

function ariaFlag(el: Element, name: string): boolean | undefined {
  const value = el.getAttribute(name);
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

export interface ElementState {
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  current?: string;
  required?: boolean;
  invalid?: boolean;
  filled?: boolean;
  value?: string;
}

export function elementState(el: Element): ElementState | undefined {
  const state: ElementState = {};
  if (el.matches(':disabled') || ariaFlag(el, 'aria-disabled')) state.disabled = true;

  const checked =
    el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
      ? el.checked
      : ariaFlag(el, 'aria-checked');
  if (checked !== undefined) state.checked = checked;

  const expanded = ariaFlag(el, 'aria-expanded');
  if (expanded !== undefined) state.expanded = expanded;

  const selected = el instanceof HTMLOptionElement ? el.selected : ariaFlag(el, 'aria-selected');
  if (selected !== undefined) state.selected = selected;

  const current = el.getAttribute('aria-current');
  if (current && current !== 'false') state.current = current;

  if (el.matches(':required') || ariaFlag(el, 'aria-required')) state.required = true;
  if (ariaFlag(el, 'aria-invalid')) state.invalid = true;

  if (el instanceof HTMLSelectElement) {
    state.value = el.selectedOptions[0]?.text.replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
  } else if (el instanceof HTMLTextAreaElement) {
    state.filled = el.value.length > 0;
  } else if (el instanceof HTMLInputElement && !VALUELESS_INPUT.has(el.type)) {
    state.filled = el.value.length > 0;
  }

  return Object.values(state).some((value) => value !== undefined) ? state : undefined;
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
    role: computedRole(el),
    selector: cssPath(el),
    text: text || undefined,
    state: elementState(el),
    bounds: documentBounds(el),
  };
}

export function submitsOnClick(el: Element): boolean {
  if (!el.closest('form')) return false;
  if (el instanceof HTMLButtonElement) return el.type === 'submit';
  return el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image');
}
