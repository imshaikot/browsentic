import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';
import { keyboardInit } from './keyboard';

const SPEEDS = { slow: 400, natural: 220, fast: 110, instant: 0 } as const;

const LINGER_AFTER: Record<string, number> = {
  '.': 3,
  '?': 3,
  '!': 3,
  '\n': 2.5,
  ',': 2,
  ';': 2,
  ':': 2,
};

const MAX_DURATION_MS = 120_000;

const keyDelays = (text: string, base: number): number[] =>
  [...text].map((char) => base * (LINGER_AFTER[char] ?? 1));

const budgetFor = (delays: readonly number[], jitter: number): number =>
  Math.round(delays.reduce((total, ms) => total + ms, 0) * (1 + jitter));

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const typeText = defineAction({
  name: 'page.typeText',
  description:
    'Stream text into a field one keystroke at a time, at a human pace — a real key event per character, pauses that vary, and longer breaths after punctuation. Use page.fillInput when you just need the value in the field; use this when the page should watch someone type.',
  input: z.object({
    target: targetSchema
      .optional()
      .describe('Element to type into; defaults to the currently focused element'),
    text: z.string().min(1).max(2000).describe('Text to type, character by character'),
    speed: z
      .enum(['slow', 'natural', 'fast', 'instant'])
      .default('natural')
      .describe(
        'Typing pace: "slow" ≈ 30 wpm, "natural" ≈ 55 wpm, "fast" ≈ 110 wpm, "instant" fires every keystroke back to back with no pause',
      ),
    charDelayMs: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .optional()
      .describe('Average milliseconds between keystrokes; overrides "speed" when given'),
    jitter: z
      .number()
      .min(0)
      .max(1)
      .default(0.35)
      .describe(
        'How much each pause varies at random, as a fraction of it — 0 types in an even machine rhythm, 1 is wildly uneven',
      ),
    clear: z.boolean().default(true).describe('Replace existing content instead of appending'),
    pressEnter: z.boolean().default(false).describe('Press Enter afterwards, which submits many forms'),
  }),
  async execute({ target, text, speed, charDelayMs, jitter, clear, pressEnter }) {
    const el = target
      ? resolveTarget(target)
      : ((document.activeElement as HTMLElement | null) ?? document.body);
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (!isField && !el.isContentEditable) {
      throw new ActionError(`<${el.tagName.toLowerCase()}> is not an editable element`, 'INVALID_TARGET');
    }
    if (text.includes('\n') && el instanceof HTMLInputElement) {
      throw new ActionError(
        'A single-line <input> cannot take newlines — drop them from "text", or set pressEnter to submit',
        'INVALID_INPUT',
      );
    }

    const base = charDelayMs ?? SPEEDS[speed];
    const delays = keyDelays(text, base);
    const budget = budgetFor(delays, jitter);
    if (budget > MAX_DURATION_MS) {
      throw new ActionError(
        `Typing ${text.length} characters at ${base}ms each would take about ${Math.round(budget / 1000)}s — raise "speed", lower "charDelayMs", or send the text in shorter pieces`,
        'INVALID_INPUT',
      );
    }

    if (clear) clearContent(el);
    focusForTyping(el);

    const start = performance.now();
    const characters = [...text];
    for (const [index, char] of characters.entries()) {
      const wait = index ? Math.round(delays[index - 1] * (1 + (Math.random() * 2 - 1) * jitter)) : 0;
      if (wait > 0) await pause(wait);
      typeCharacter(el, char);
    }

    let submitted = false;
    if (pressEnter) {
      const enter = keyboardInit('Enter');
      const notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', enter));
      el.dispatchEvent(new KeyboardEvent('keyup', enter));
      if (notPrevented && !(el instanceof HTMLTextAreaElement)) {
        const form = el.closest('form');
        form?.requestSubmit();
        submitted = !!form;
      }
    }

    return {
      element: describeElement(el),
      typed: characters.length,
      charDelayMs: base,
      elapsedMs: Math.round(performance.now() - start),
      appended: !clear,
      submitted,
    };
  },
});

export function typingDurationMs(input: unknown): number {
  const parsed = typeText.input.safeParse(input ?? {});
  if (!parsed.success) return 0;
  const { text, speed, charDelayMs, jitter } = parsed.data;
  return budgetFor(keyDelays(text, charDelayMs ?? SPEEDS[speed]), jitter);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
}

function clearContent(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setNativeValue(el, '');
  else el.textContent = '';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
}

function focusForTyping(el: HTMLElement): void {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {}
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertCharacter(el: HTMLElement, char: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setNativeValue(el, el.value.slice(0, start) + char + el.value.slice(end));
    const caret = start + char.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {}
  } else if (document.execCommand('insertText', false, char)) {
    return;
  } else {
    el.textContent = (el.textContent ?? '') + char;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
}

function typeCharacter(el: HTMLElement, char: string): void {
  const init = keyboardInit(char === '\n' ? 'Enter' : char);
  const notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', init));
  if (notPrevented) {
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    insertCharacter(el, char);
  }
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}
