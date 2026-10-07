import { accessibleText, computedRole } from '@/lib/actions/page/dom';

export const LABEL_MAX = 40;

const TYPED_INTO = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const BUTTON_TYPES = new Set(['submit', 'button', 'reset']);

type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** What a sighted user would call the element. Something the agent can type into is named, never read aloud. */
export function cueLabel(el: Element): string {
  const role = computedRole(el);
  const typedInto = !isFormField(el) && (isEditable(el) || role === 'textbox' || role === 'searchbox');
  const name = typedInto ? quietName(el) : spokenName(el);
  return clip(name || role || el.tagName.toLowerCase());
}

function spokenName(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  if (isFormField(el) && !(el instanceof HTMLInputElement && BUTTON_TYPES.has(el.type))) {
    return textOutsideFields(el.labels?.[0]) || el.getAttribute('placeholder')?.trim() || el.name;
  }
  return el.querySelector(TYPED_INTO) ? textOutsideFields(el) : accessibleText(el);
}

function isFormField(el: Element): el is FormField {
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

function textOutsideFields(root: Element | null | undefined): string {
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  while (walker.nextNode()) {
    const field = walker.currentNode.parentElement?.closest(TYPED_INTO);
    if (!field || !root.contains(field)) text += walker.currentNode.textContent ?? '';
  }
  return text.trim();
}

export function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}
