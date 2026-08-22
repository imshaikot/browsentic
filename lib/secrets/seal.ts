/**
 * Sealing: turning a found secret into a placeholder that says what it was without
 * being it, and back again at the one place it is allowed to become plaintext.
 *
 * A handle reads `⟦kind:id@host#tag⟧`. Everything in it is public — the kind and the
 * host are what make a truncated value still useful to reason about — except the tag,
 * which is minted once per browser session and never rendered anywhere a page can read
 * it. That is the whole trick: a page can author the brackets, but it cannot author the
 * tag, so a page-planted handle resolves to nothing. Sealing in strict mode also
 * rewrites any bracket that is not one of our own handles, so a forgery does not even
 * survive the trip out of the page.
 *
 * Sealing is idempotent. An already-sealed handle is an immune range, never rescanned,
 * which is what lets the extension seal on the way out and the daemon seal again on the
 * way through without the second pass mangling the first.
 */

import { findSecrets, rangesOf, type Range } from './detect';
import { NOTHING, kindForKey, notAPlaceholder, type Reveal, type SecretKind } from './shapes';

export const OPEN = '⟦';
export const CLOSE = '⟧';

const ANY_HANDLE = /⟦([a-z-]+):([0-9a-z]+)(?:@([A-Za-z0-9._:\[\]-]{1,255}))?#([0-9a-f]{6,32})⟧/g;

export interface Handle {
  readonly kind: SecretKind;
  readonly id: string;
  readonly origin?: string;
  readonly tag: string;
  readonly text: string;
}

export interface SealedFinding {
  readonly kind: SecretKind;
  readonly shape: string;
  readonly handle: string;
}

/** Mints the handle for one found secret. The caller owns the id space and the vault. */
export type Mint = (value: string, kind: SecretKind, shape: string) => string;

export interface SealOptions {
  readonly mint: Mint;
  /**
   * Our own tag. Given, sealing is strict: only our handles survive and every other
   * bracket is rewritten. Omitted, any well-formed handle passes through untouched —
   * what a downstream sealer wants, since it is not the one that minted them.
   */
  readonly tag?: string;
}

export interface Sealed<T> {
  readonly value: T;
  readonly found: SealedFinding[];
}

export function handleFor(part: { kind: SecretKind; id: string; origin?: string }, tag: string): string {
  const origin = part.origin ? `@${part.origin}` : '';
  return `${OPEN}${part.kind}:${part.id}${origin}#${tag}${CLOSE}`;
}

export function handlesIn(text: string, tag?: string): Handle[] {
  if (!text.includes(OPEN)) return [];
  return [...text.matchAll(ANY_HANDLE)]
    .map((match) => ({
      kind: match[1] as SecretKind,
      id: match[2],
      origin: match[3],
      tag: match[4],
      text: match[0],
    }))
    .filter((handle) => !tag || handle.tag === tag);
}

/** Every handle anywhere in a JSON value — what a policy decision reads. */
export function sealedHandles(value: unknown, tag?: string): Handle[] {
  const found: Handle[] = [];
  walk(value, 0, (text) => {
    found.push(...handlesIn(text, tag));
    return text;
  });
  return found;
}

export function sealText(text: string, options: SealOptions): Sealed<string> {
  if (!text || text.length < 4) return { value: text, found: [] };

  const immune = ourHandles(text, options.tag);
  const source = options.tag ? neutralize(text, immune) : text;
  const spans = findSecrets(source, immune);
  if (!spans.length) return { value: source, found: [] };

  const found: SealedFinding[] = [];
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    const handle = options.mint(span.value, span.kind, span.shape);
    found.push({ kind: span.kind, shape: span.shape, handle });
    out += source.slice(cursor, span.start) + truncate(span.value, span.reveal, handle);
    cursor = span.end;
  }
  return { value: out + source.slice(cursor), found };
}

/**
 * Keys whose value is a round-trip token the agent has to hand back verbatim. Sealing a
 * selector would break targeting and report it as a refused secret, which reads as a bug
 * rather than as a policy.
 */
const STRUCTURAL_KEYS = new Set(['selector']);

const MIN_KEYED = 4;

/**
 * Seal every string in a value tree. Two ways in: a string that carries a secret inside
 * it, and a string that *is* one because of the key it hangs off. The second is what a
 * walked result needs — `{ password: "hunter2" }` has no label in any string being
 * scanned, so nothing but the key says what it is.
 */
export function sealValue<T>(value: T, options: SealOptions): Sealed<T> {
  const found: SealedFinding[] = [];

  const keyed = (text: string, kind: SecretKind): string => {
    const whole = findSecrets(text).find((span) => span.start === 0 && span.end === text.length);
    const known = whole ? { kind: whole.kind, shape: whole.shape, reveal: whole.reveal } : { kind, shape: 'keyed', reveal: NOTHING };
    const handle = options.mint(text, known.kind, known.shape);
    found.push({ kind: known.kind, shape: known.shape, handle });
    return truncate(text, known.reveal, handle);
  };

  const visit = (node: unknown, depth: number, kind: SecretKind | null): unknown => {
    if (typeof node === 'string') {
      if (node.startsWith('data:')) return node;
      if (kind && node.length >= MIN_KEYED && notAPlaceholder(node) && !handlesIn(node).length) return keyed(node, kind);
      const sealed = sealText(node, options);
      found.push(...sealed.found);
      return sealed.value;
    }
    if (depth >= MAX_DEPTH || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => visit(item, depth + 1, kind));
    const out: Record<string, unknown> = {};
    for (const [name, nested] of Object.entries(node as Record<string, unknown>)) {
      out[name] = STRUCTURAL_KEYS.has(name) ? nested : visit(nested, depth + 1, kindForKey(name));
    }
    return out;
  };

  return { value: visit(value, 0, null) as T, found };
}

/**
 * Substitute our own handles for the plaintext they stand for. `resolve` returning null
 * leaves the handle in place and reports it, so the caller can refuse rather than type a
 * placeholder into someone's login form.
 */
export function releaseText(
  text: string,
  tag: string,
  resolve: (handle: Handle) => string | null,
): { text: string; released: Handle[]; unresolved: Handle[] } {
  const released: Handle[] = [];
  const unresolved: Handle[] = [];
  const out = text.replace(ANY_HANDLE, (match, kind, id, origin, found) => {
    const handle: Handle = { kind, id, origin, tag: found, text: match };
    if (found !== tag) {
      unresolved.push(handle);
      return match;
    }
    const plain = resolve(handle);
    if (plain === null) {
      unresolved.push(handle);
      return match;
    }
    released.push(handle);
    return plain;
  });
  return { text: out, released, unresolved };
}

/**
 * `head…⟦handle⟧…tail`, with the ellipsis only on a side that kept something. What
 * survives is the vendor's format marker or a card's last four — never entropy.
 */
function truncate(value: string, reveal: Reveal, handle: string): string {
  const room = Math.max(0, value.length - 4);
  const head = value.slice(0, Math.min(reveal.head, room));
  const tail = reveal.tail && value.length - reveal.tail > head.length ? value.slice(-reveal.tail) : '';
  return `${head}${head ? '…' : ''}${handle}${tail ? '…' : ''}${tail}`;
}

function ourHandles(text: string, tag?: string): Range[] {
  if (!text.includes(OPEN)) return [];
  return [...text.matchAll(ANY_HANDLE)]
    .filter((match) => !tag || match[4] === tag)
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

/** Rewrite every bracket that is not one of our handles, so a page cannot author one. */
function neutralize(text: string, immune: readonly Range[]): string {
  if (!text.includes(OPEN) && !text.includes(CLOSE)) return text;
  const inside = (at: number) => immune.some((range) => at >= range.start && at < range.end);
  let out = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (inside(at)) out += char;
    else if (char === OPEN) out += '⟨';
    else if (char === CLOSE) out += '⟩';
    else out += char;
  }
  return out;
}

const MAX_DEPTH = 12;

function walk(value: unknown, depth: number, onText: (text: string) => string): unknown {
  if (typeof value === 'string') return value.startsWith('data:') ? value : onText(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, onText));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = walk(nested, depth + 1, onText);
  }
  return out;
}

export { rangesOf };
