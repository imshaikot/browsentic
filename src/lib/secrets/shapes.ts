/**
 * What counts as a secret, as data.
 *
 * The detector is deliberately dumb: a closed list of patterns, a label vocabulary and
 * one entropy gate. No model, no heuristic that depends on what was asked — the same
 * text always yields the same findings, on both sides of the socket, which is the only
 * way a client-side seal and a daemon-side seal can agree about what is already sealed.
 *
 * `reveal` is the interesting field. Truncating from the middle is useful to a reader
 * only if what survives says something, and the only characters that say something
 * without giving anything away are the ones a vendor puts there as a format marker:
 * `sk-ant-`, `ghp_`, `AKIA`. Those are public by construction. Everything else — a
 * password, a cookie, a bare high-entropy blob — reveals nothing, because four
 * characters of a password is four characters of a password.
 */

import { looksLikeCardNumber } from '@/lib/recordings/events';

export type SecretKind = 'api-key' | 'token' | 'jwt' | 'password' | 'cookie' | 'private-key' | 'card' | 'secret';

export interface Reveal {
  /** Leading characters that are a public format marker, not entropy. */
  readonly head: number;
  readonly tail: number;
}

export interface Shape {
  readonly id: string;
  readonly kind: SecretKind;
  /** Global. When it captures, the first defined capture group is the secret. */
  readonly pattern: RegExp;
  /** Lowercase substring the text must contain before the pattern is worth running. */
  readonly guard?: string;
  readonly reveal?: Reveal;
  readonly validate?: (value: string) => boolean;
}

export const NOTHING: Reveal = { head: 0, tail: 0 };

/**
 * The label vocabulary, as word parts. Both readers derive from it and cannot drift:
 * `labelled()` joins the parts with an optional separator to find `api_key: …` inside a
 * string, and `kindForKey()` joins them bare to recognise `apiKey` as an object key. The
 * second reader is the one that matters client-side, where a result is walked as a value
 * tree and `{ password: "hunter2" }` has no label anywhere in the string being scanned.
 */
type Word = readonly string[];

const PASSWORD_WORDS: readonly Word[] = [
  ['pass', 'word'],
  ['pass', 'wd'],
  ['pass', 'phrase'],
  ['pass', 'code'],
  ['pwd'],
  ['otp'],
  ['one', 'time', 'code'],
];

const TOKEN_WORDS: readonly Word[] = [
  ['secret'],
  ['token'],
  ['api', 'key'],
  ['access', 'key'],
  ['access', 'token'],
  ['secret', 'key'],
  ['client', 'secret'],
  ['refresh', 'token'],
  ['auth', 'token'],
  ['authorization'],
  ['bearer'],
  ['credential'],
  ['credentials'],
  ['signing', 'key'],
  ['private', 'key'],
  ['connection', 'string'],
];

const COOKIE_WORDS: readonly Word[] = [
  ['cookie'],
  ['session', 'id'],
  ['session', 'key'],
  ['session', 'token'],
  ['csrf', 'token'],
  ['xsrf', 'token'],
];

const inline = (words: readonly Word[]) => words.map((word) => word.join(String.raw`[_\-\s]?`)).join('|');

const PASSWORD_LABEL = inline(PASSWORD_WORDS);
const TOKEN_LABEL = inline(TOKEN_WORDS);
const COOKIE_LABEL = inline(COOKIE_WORDS);

const KEY_WORDS: readonly (readonly [SecretKind, readonly Word[]])[] = [
  ['password', PASSWORD_WORDS],
  ['token', TOKEN_WORDS],
  ['cookie', COOKIE_WORDS],
];

/**
 * The kind an object key names, or null. Matched on the key with its separators removed,
 * so `newPassword`, `new_password` and `NEW-PASSWORD` all read the same.
 */
export function kindForKey(key: string): SecretKind | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return null;
  const forms = normalized.endsWith('s') ? [normalized, normalized.slice(0, -1)] : [normalized];
  for (const [kind, words] of KEY_WORDS) {
    if (words.some((word) => forms.some((form) => form.endsWith(word.join(''))))) return kind;
  }
  return null;
}

/** Every label in canonical form, for docs and for the check that the two readers agree. */
export const SECRET_WORDS: readonly string[] = [...PASSWORD_WORDS, ...TOKEN_WORDS, ...COOKIE_WORDS].map((word) =>
  word.join('_'),
);

/** Quoted or bare, with the scheme words a header puts in front of the value stripped off. */
const VALUE = String.raw`(?:Bearer\s+|Basic\s+|Token\s+)?(?:"([^"\r\n]{4,400})"|'([^'\r\n]{4,400})'|([^\s,;&"'<>{}\[\]]{4,400}))`;

const labelled = (label: string) =>
  new RegExp(String.raw`(?<![A-Za-z0-9])(?:${label})["']?\s*[:=]\s*${VALUE}`, 'gi');

/**
 * The same labels joined by an English verb rather than a colon, because that is how a
 * page actually hands someone a credential: “your temporary password is …”. The value
 * runs to whitespace and may hold the punctuation a password holds, but not the
 * punctuation a sentence ends on.
 */
const PROSE_VALUE = String.raw`(?:"([^"\r\n]{4,400})"|'([^'\r\n]{4,400})'|([^\s"'<>]{3,399}[^\s"'<>.,;:!?]))`;

const prose = (label: string) =>
  new RegExp(String.raw`(?<![A-Za-z0-9])(?:${label})\s+(?:is|are|was|will\s+be)\s*:?\s+${PROSE_VALUE}`, 'gi');

/**
 * Prose is mostly ordinary words, so a value that follows “password is” only counts when
 * it looks unlike one: a digit, a symbol a password uses, or a case change mid-word.
 * “The password is required” stays a sentence.
 */
const CREDENTIAL_SIGNAL = /\d|[!@#$%^&*()_+=\[\]{}|\\<>~/&]|[a-z][A-Z]/;

export function looksLikeCredential(value: string): boolean {
  return value.length >= 6 && notAPlaceholder(value) && CREDENTIAL_SIGNAL.test(value);
}

/**
 * Values that occupy a secret's slot without being one. Left in place so a page that
 * says `password: ********` still reads as a page that says nothing.
 */
const PLACEHOLDER =
  /^(?:null|nil|none|true|false|undefined|n\/?a|empty|blank|test|demo|example|sample|changeme|hidden|redacted|your[-_\s].*|my[-_\s].*|x{3,}|\*+|•+|\.{3,}|…+|-+|_+|\[[^\]]*\]|<[^>]*>|\{\{.*\}\}|\$\{.*\})$/i;

export function notAPlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return false;
  if (/^(.)\1*$/.test(value)) return false;
  return !value.includes('…');
}

export const SHAPES: readonly Shape[] = [
  {
    id: 'private-key',
    kind: 'private-key',
    guard: '-----begin',
    pattern: /-----BEGIN(?:[A-Z ]{0,32})PRIVATE KEY-----[A-Za-z0-9+/=\s]{0,8000}-----END(?:[A-Z ]{0,32})PRIVATE KEY-----/g,
  },
  { id: 'jwt', kind: 'jwt', guard: 'eyj', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g },

  { id: 'anthropic-key', kind: 'api-key', guard: 'sk-ant-', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, reveal: { head: 7, tail: 0 } },
  { id: 'openai-key', kind: 'api-key', guard: 'sk-', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, reveal: { head: 3, tail: 0 } },
  { id: 'google-key', kind: 'api-key', guard: 'aiza', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, reveal: { head: 4, tail: 0 } },
  { id: 'aws-access-key', kind: 'api-key', pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AGPA|ANPA)[0-9A-Z]{16}\b/g, reveal: { head: 4, tail: 0 } },
  { id: 'github-pat', kind: 'token', guard: 'github_pat_', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}/g, reveal: { head: 11, tail: 0 } },
  { id: 'github-token', kind: 'token', guard: 'gh', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, reveal: { head: 4, tail: 0 } },
  { id: 'slack-token', kind: 'token', guard: 'xox', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, reveal: { head: 4, tail: 0 } },
  { id: 'stripe-key', kind: 'api-key', guard: 'k_', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, reveal: { head: 8, tail: 0 } },
  { id: 'npm-token', kind: 'token', guard: 'npm_', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, reveal: { head: 4, tail: 0 } },
  { id: 'gitlab-token', kind: 'token', guard: 'glpat-', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g, reveal: { head: 6, tail: 0 } },
  { id: 'sendgrid-key', kind: 'api-key', guard: 'sg.', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, reveal: { head: 3, tail: 0 } },

  { id: 'basic-auth', kind: 'password', guard: '@', pattern: /\bhttps?:\/\/[^\s/:@]{1,64}:([^\s/@]{3,128})@/g },
  { id: 'cookie-header', kind: 'cookie', guard: 'cookie', pattern: /(?:^|\n)[ \t]*(?:set-)?cookie[ \t]*:[ \t]*([^\r\n]{4,4000})/gi },

  { id: 'labelled-password', kind: 'password', pattern: labelled(PASSWORD_LABEL), validate: notAPlaceholder },
  { id: 'labelled-token', kind: 'token', pattern: labelled(TOKEN_LABEL), validate: notAPlaceholder },
  { id: 'labelled-cookie', kind: 'cookie', pattern: labelled(COOKIE_LABEL), validate: notAPlaceholder },

  { id: 'prose-password', kind: 'password', pattern: prose(PASSWORD_LABEL), validate: looksLikeCredential },
  { id: 'prose-token', kind: 'token', pattern: prose(TOKEN_LABEL), validate: looksLikeCredential },

  { id: 'card', kind: 'card', pattern: /\b\d(?:[ -]?\d){12,18}\b/g, reveal: { head: 0, tail: 4 }, validate: looksLikeCardNumber },
];
