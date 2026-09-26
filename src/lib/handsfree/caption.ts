import type { RunItem } from '@/lib/bridge/run-items';
import type { CaptionTone } from './events';

const MAX_SPOKEN_CHARS = 280;

/** The last word of a finished turn — its latest reply or error — or nothing, if the turn said neither. */
export function replyOf(items: readonly RunItem[]): { text: string; tone: CaptionTone } | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.kind === 'user') return null;
    if (item.kind === 'assistant' && item.text.trim()) return { text: captionOf(item.text), tone: 'reply' };
    if (item.kind === 'notice' && item.tone === 'error') {
      return { text: captionOf(item.text.replace(/^[A-Z][A-Z_]+:\s*/, '')), tone: 'error' };
    }
  }
  return null;
}

export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** How many leading words two readings share — those keep their place, and only the rest stream in. */
export function sharedWords(before: readonly string[], after: readonly string[]): number {
  let shared = 0;
  while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared += 1;
  return shared;
}

/** A reply as a caption can carry it: markdown stripped, one paragraph, cut at a word. */
export function captionOf(markdown: string, max = MAX_SPOKEN_CHARS): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** Long enough to read at an unhurried pace, never so long it lingers after the page moved on. */
export const readingMs = (text: string): number => Math.min(16_000, Math.max(4_000, 2_500 + wordsOf(text).length * 300));
