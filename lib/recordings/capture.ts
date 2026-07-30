import { accessibleText, cssPath } from '@/lib/actions/page/dom';
import {
  CLICK_DEDUP_MS,
  FLUSH_AT_EVENTS,
  FLUSH_INTERVAL_MS,
  MAX_SELECTOR_CHARS,
  MAX_TEXT_CHARS,
  MAX_VALUE_CHARS,
  SCROLL_BEFORE_CLICK_MS,
  SCROLL_INTERVAL_MS,
  isSensitiveField,
  variableSlug,
  type RecordedEvent,
  type RecordedTarget,
} from './events';

export interface CaptureOptions {
  captureValues: boolean;
  send: (events: RecordedEvent[]) => void;
}

const COMMAND_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export function startCapture({ captureValues, send }: CaptureOptions): () => void {
  const queue: RecordedEvent[] = [];
  const slugs = new Set<string>();
  const slugFor = new Map<string, string>();
  let pendingFill: { el: Editable; target: RecordedTarget } | null = null;
  let lastClickAt = 0;
  let lastClickSelector = '';
  let lastScrollAt = 0;
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  const flush = () => {
    if (!queue.length) return;
    send(queue.splice(0, queue.length));
  };

  const push = (event: RecordedEvent) => {
    queue.push(event);
    if (queue.length >= FLUSH_AT_EVENTS) flush();
  };

  const targetFor = (el: Element): RecordedTarget => {
    const text = accessibleText(el).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    return {
      selector: cssPath(el).slice(0, MAX_SELECTOR_CHARS),
      text: text || undefined,
      role: el.getAttribute('role')?.toLowerCase() || el.tagName.toLowerCase(),
    };
  };

  const valueFor = (el: Editable, field: string, key: string): string => {
    const raw =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value
        : (el.textContent ?? '');
    const sensitive = isSensitiveField({
      type: el instanceof HTMLInputElement ? el.type : 'text',
      name: el.getAttribute('name') ?? '',
      id: el.id,
      autocomplete: el.getAttribute('autocomplete') ?? '',
      value: raw,
    });
    if (!captureValues || sensitive) {
      const existing = slugFor.get(key);
      if (existing) return `{{${existing}}}`;
      const slug = variableSlug(field, slugs);
      slugs.add(slug);
      slugFor.set(key, slug);
      return `{{${slug}}}`;
    }
    return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_CHARS);
  };

  const commitFill = () => {
    const pending = pendingFill;
    pendingFill = null;
    if (!pending) return;
    const { el, target } = pending;
    const field = target.text || el.getAttribute('name') || el.id || 'field';
    const inputKind = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
    push({
      t: Date.now(),
      kind: 'fill',
      target,
      field: field.slice(0, MAX_TEXT_CHARS),
      inputKind,
      value: valueFor(el, field, target.selector),
      url: location.href,
    });
  };

  const dropTrailingScroll = () => {
    const last = queue[queue.length - 1];
    if (last?.kind === 'scroll' && Date.now() - last.t < SCROLL_BEFORE_CLICK_MS) queue.pop();
  };

  const onInput = (event: Event) => {
    const el = event.target;
    if (!isEditable(el)) return;
    if (pendingFill && pendingFill.el !== el) commitFill();
    if (!pendingFill) pendingFill = { el, target: targetFor(el) };
  };

  const onChange = (event: Event) => {
    const el = event.target;
    if (el instanceof HTMLSelectElement) {
      const option = el.selectedOptions[0];
      push({
        t: Date.now(),
        kind: 'select',
        target: targetFor(el),
        value: el.value.slice(0, MAX_VALUE_CHARS),
        label: option?.text.trim().slice(0, MAX_TEXT_CHARS) || undefined,
        url: location.href,
      });
      return;
    }
    if (pendingFill && pendingFill.el === el) commitFill();
  };

  const onBlur = (event: Event) => {
    if (pendingFill && pendingFill.el === event.target) commitFill();
  };

  const onClick = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    const clickable = el.closest('a,button,input,select,textarea,summary,label,[role],[onclick]') ?? el;
    if (clickable instanceof HTMLInputElement && (clickable.type === 'text' || clickable.type === 'password')) {
      return;
    }
    const target = targetFor(clickable);
    const now = Date.now();
    if (target.selector === lastClickSelector && now - lastClickAt < CLICK_DEDUP_MS) return;
    lastClickAt = now;
    lastClickSelector = target.selector;
    commitFill();
    dropTrailingScroll();
    push({ t: now, kind: 'click', target, url: location.href });
  };

  const onKeyDown = (event: Event) => {
    const key = event as KeyboardEvent;
    const modifiers = [
      key.ctrlKey && 'Control',
      key.metaKey && 'Meta',
      key.altKey && 'Alt',
      key.shiftKey && 'Shift',
    ].filter((m): m is string => typeof m === 'string');
    if (!COMMAND_KEYS.has(key.key) && !modifiers.some((m) => m !== 'Shift')) return;
    if (key.key === 'Enter' || key.key === 'Tab') commitFill();
    const el = key.target;
    push({
      t: Date.now(),
      kind: 'key',
      key: key.key,
      modifiers,
      target: el instanceof Element ? targetFor(el) : undefined,
      url: location.href,
    });
  };

  const onSubmit = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    commitFill();
    push({ t: Date.now(), kind: 'submit', target: targetFor(el), url: location.href });
    flush();
  };

  const onScroll = () => {
    const now = Date.now();
    if (now - lastScrollAt < SCROLL_INTERVAL_MS) return;
    lastScrollAt = now;
    const last = queue[queue.length - 1];
    if (last?.kind === 'scroll') queue.pop();
    push({ t: now, kind: 'scroll', y: Math.round(window.scrollY), url: location.href });
  };

  const onCopy = () => {
    const selection = window.getSelection();
    const el = selection?.anchorNode;
    const element = el instanceof Element ? el : (el?.parentElement ?? null);
    if (!element) return;
    push({
      t: Date.now(),
      kind: 'copy',
      target: targetFor(element),
      length: selection?.toString().length ?? 0,
      url: location.href,
    });
  };

  const onPageHide = () => {
    commitFill();
    flush();
  };

  const listeners: [string, EventListener, boolean][] = [
    ['input', onInput, true],
    ['change', onChange, true],
    ['blur', onBlur, true],
    ['click', onClick, true],
    ['keydown', onKeyDown, true],
    ['submit', onSubmit, true],
    ['copy', onCopy, true],
  ];
  for (const [type, handler, capture] of listeners) {
    document.addEventListener(type, handler, capture);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', onPageHide);
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  return () => {
    for (const [type, handler, capture] of listeners) {
      document.removeEventListener(type, handler, capture);
    }
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', onPageHide);
    if (flushTimer) clearInterval(flushTimer);
    commitFill();
    flush();
  };
}

function isEditable(el: unknown): el is Editable {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}
