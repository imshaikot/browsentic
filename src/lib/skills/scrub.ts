const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]',
  'g',
);

export const SELECTOR_RE = /^[a-zA-Z0-9 .#>+~*,_:[\]="'()-]{1,120}$/;

export const MAX_SELECTOR_PARTS = 8;

export function scrub(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/^[\s#>*\-+|`~=]+/, '')
    .replace(/[`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function looksLikeInstruction(text: string): boolean {
  return /\b(?:ignore (?:all |any )?previous|disregard (?:the |all )?(?:above|previous)|you (?:must|should|will) (?:now|always|never)|instead(?:,)? (?:navigate|go|send|email|transfer|click)|do not tell|without asking|system prompt|new instructions?)\b/i.test(
    text,
  );
}

export function looksLikeSelector(value: string): boolean {
  return SELECTOR_RE.test(value) && value.trim().split(/\s+/).length <= MAX_SELECTOR_PARTS;
}

export function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
