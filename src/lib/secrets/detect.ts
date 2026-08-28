/**
 * Finding the secrets in a string. Pure, total, and order-independent: the shapes are
 * tried in declaration order and a later match that overlaps an earlier one is dropped,
 * so `sk-ant-…` is an Anthropic key rather than the generic `sk-` key it also matches.
 *
 * The last pass is the one that needs justifying. Shapes and labels only find secrets
 * that announce themselves; a bare token sitting on a page under a heading two lines up
 * announces nothing. The entropy gate catches those, and every clause in it exists to
 * keep something specific out: digests and ids are hex, identifiers are camel case with
 * a digit on the end, asset hashes live in a URL path. The threshold sits above where
 * concatenated English words land and well below where random base64 does.
 */

import { NOTHING, SHAPES, type Reveal, type SecretKind } from './shapes';

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly kind: SecretKind;
  readonly shape: string;
  readonly reveal: Reveal;
}

export interface Range {
  readonly start: number;
  readonly end: number;
}

const CANDIDATE = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{32,4096}={0,2}(?![A-Za-z0-9+/_-])/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTROPY_BITS = 4.3;
/**
 * How often case flips between adjacent letters. Random credentials flip about half the
 * time; identifiers written by a person flip once per word. Measured over both, the two
 * populations do not overlap, and requiring both signals is what keeps a page's
 * `ContinueReadingTheFullArticle` out of the vault.
 */
const CASE_FLIPS = 0.5;

/** Inline data URLs are image bytes, not credentials, and scanning them is pure cost. */
const DATA_URL = /\bdata:[^\s;,]{0,80};base64,[A-Za-z0-9+/=]+/g;

export function findSecrets(text: string, immune: readonly Range[] = []): Span[] {
  if (!text) return [];
  const claimed = [...immune, ...rangesOf(text, DATA_URL)].sort((a, b) => a.start - b.start);
  const lower = text.toLowerCase();
  const found: Span[] = [];

  const take = (span: Span) => {
    if (overlaps(claimed, span)) return;
    claimed.push(span);
    claimed.sort((a, b) => a.start - b.start);
    found.push(span);
  };

  for (const shape of SHAPES) {
    if (shape.guard && !lower.includes(shape.guard)) continue;
    for (const match of text.matchAll(shape.pattern)) {
      const at = secretIn(match);
      if (!at) continue;
      if (shape.validate && !shape.validate(at.value)) continue;
      take({ ...at, kind: shape.kind, shape: shape.id, reveal: shape.reveal ?? NOTHING });
    }
  }

  for (const match of text.matchAll(CANDIDATE)) {
    const value = match[0];
    if (!looksHighEntropy(value)) continue;
    take({
      start: match.index,
      end: match.index + value.length,
      value,
      kind: 'secret',
      shape: 'high-entropy',
      reveal: NOTHING,
    });
  }

  return found.sort((a, b) => a.start - b.start);
}

/** The first defined capture group is the secret; with no groups, the whole match is. */
function secretIn(match: RegExpExecArray | RegExpMatchArray): { start: number; end: number; value: string } | null {
  if (match.index === undefined) return null;
  const captured = match.slice(1).find((group) => group !== undefined);
  if (captured === undefined) {
    return { start: match.index, end: match.index + match[0].length, value: match[0] };
  }
  if (!captured) return null;
  const offset = match[0].lastIndexOf(captured);
  if (offset < 0) return null;
  return { start: match.index + offset, end: match.index + offset + captured.length, value: captured };
}

function looksHighEntropy(value: string): boolean {
  if (value.length < 32) return false;
  if (UUID.test(value)) return false;
  if (/^[0-9a-f]+$/i.test(value)) return false;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return false;
  return entropy(value) >= ENTROPY_BITS && caseFlips(value) >= CASE_FLIPS;
}

export function caseFlips(value: string): number {
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return 0;
  let flips = 0;
  for (let at = 1; at < letters.length; at += 1) {
    if (isUpper(letters[at]) !== isUpper(letters[at - 1])) flips += 1;
  }
  return flips / (letters.length - 1);
}

const isUpper = (char: string) => char === char.toUpperCase();

export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

export function rangesOf(text: string, pattern: RegExp): Range[] {
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function overlaps(claimed: readonly Range[], span: Range): boolean {
  return claimed.some((range) => span.start < range.end && range.start < span.end);
}
