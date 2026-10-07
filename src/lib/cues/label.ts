import { accessibleText, computedRole } from '@/lib/actions/page/dom';

export const LABEL_MAX = 40;

/** What a sighted user would call the element. Something the agent can type into is named, never read aloud. */
export function cueLabel(el: Element): string {
  const role = computedRole(el);
  const typedInto = !isFormField(el) && (isEditable(el) || role === 'textbox' || role === 'searchbox');
  const name = typedInto ? quietName(el) : accessibleText(el);
  return clip(name || role || el.tagName.toLowerCase());
}

function isFormField(el: Element): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function isEditable(el: Element): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true');
}

function quietName(el: Element): string {
  return (
    el.getAttribute('aria-label')?.trim() ||
    el.getAttribute('aria-placeholder')?.trim() ||
    el.getAttribute('placeholder')?.trim() ||
    el.getAttribute('title')?.trim() ||
    ''
  );
}

export function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}
