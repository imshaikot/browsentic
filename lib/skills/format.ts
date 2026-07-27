/**
 * The skill file format, shared by the extension and the daemon.
 *
 * Skills are markdown files with a small `key: value` front matter. The daemon reads them to
 * build a run's system prompt; the extension writes them when a user uploads one. Both ends
 * need the same parser and the same rules, so this module is the single copy — and it imports
 * nothing, so it loads in a content script, an MV3 worker, and bare Node alike.
 */

/**
 * `general` skills are the base prompt for a run and compete on trigger words.
 * `site-exploration` skills are overlays: never a base, applied on top of one whenever the
 * active tab's host matches their `domains`.
 */
export type SkillCategory = 'general' | 'site-exploration';

export const SKILL_CATEGORIES: readonly SkillCategory[] = ['general', 'site-exploration'];

/** An uploaded skill as it crosses the wire, before the daemon serializes it to disk. */
export interface SkillDraft {
  name: string;
  description: string;
  category: SkillCategory;
  /** Hosts this skill applies to. Required for `site-exploration`, ignored otherwise. */
  domains: string[];
  /** Phrases that pull a `general` skill into the base slot. Ignored for `site-exploration`. */
  triggers: string[];
  /** The markdown that becomes the system prompt — front matter already stripped. */
  body: string;
}

/**
 * Mirrors the `@name` regex in the daemon's router: a name outside this shape could never be
 * addressed explicitly. It also makes a skill name safe to use as a filename by construction.
 */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * The whole system prompt is passed as one argv element to `claude --append-system-prompt`,
 * and Linux caps a single argument at 128 KB. Stay well under it: a body that blows the limit
 * fails as an opaque spawn error, on Linux only.
 */
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_DOMAINS = 20;
export const MAX_TRIGGERS = 30;

/**
 * A hostname, matched positively rather than by ruling characters out. A substring check is not
 * enough here: `domains` is serialized as `[a, b]` and read back with a comma split, so a value
 * containing a comma would pass a "has a dot, has no star" test and then load as *two* domains —
 * one of them never reviewed. Requiring the whole string to be label-dot-label closes that.
 */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_DESCRIPTION = 300;
const MIN_TRIGGER = 3;
const MAX_TRIGGER = 60;

/**
 * A deliberately small reader for the `key: value` front matter these files use — enough for
 * strings and flat `[a, b]` lists, and not worth a YAML dependency for a format this size.
 *
 * The pattern is anchored at position 0 with a lazy body, so it only ever consumes a header at
 * the very start of the file and stops at that header's own closing fence. A `---` rule later
 * in the markdown is inert.
 */
export function splitFrontMatter(raw: string): { fields: Record<string, string>; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!match) return { fields: {}, body: raw };

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { fields, body: raw.slice(match[0].length) };
}

export function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function parseCategory(value?: string): SkillCategory {
  return value?.trim() === 'site-exploration' ? 'site-exploration' : 'general';
}

/**
 * The inverse of `splitFrontMatter`. Every value is flattened to a single line first: the
 * parser above splits on newlines and takes everything before the first colon, so an
 * unflattened value could smuggle in an arbitrary field — `default: true` most damagingly.
 * `default` itself is never written, so an upload can never claim the fallback slot.
 */
export function serializeSkillFile(draft: SkillDraft): string {
  const lines = [`name: ${flatten(draft.name)}`];
  if (draft.description) lines.push(`description: ${flatten(draft.description)}`);
  if (draft.category !== 'general') lines.push(`category: ${flatten(draft.category)}`);
  if (draft.domains.length) lines.push(`domains: [${draft.domains.map(flatten).join(', ')}]`);
  if (draft.triggers.length) lines.push(`triggers: [${draft.triggers.map(flatten).join(', ')}]`);
  return `---\n${lines.join('\n')}\n---\n\n${draft.body.replace(/\r\n/g, '\n').trim()}\n`;
}

/** Collapse anything that would break out of a single front-matter line. */
function flatten(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `https://a.example.com:8443/x?y` → `a.example.com`; empty when the URL is unusable. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Accept what a user is likely to paste — a bare host, a full URL, a trailing slash. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  const fromUrl = trimmed.includes('://') ? hostnameOf(trimmed) : trimmed;
  return fromUrl
    .replace(/^\/+|\/+$/g, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^\.+|\.+$/g, '');
}

/** A whole hostname, or the one dotless name worth allowing. */
export function isDomain(value: string): boolean {
  return value === 'localhost' || (value.length <= 253 && DOMAIN_RE.test(value));
}

/**
 * The skill name for a mapped host: `www.acme.com` → `acme-com`.
 *
 * The dot-to-hyphen mangle is lossy — `a.b.com` and `a-b.com` both reduce to `a-b-com` — and a
 * collision here means one map's directory replaces another's, screenshots and all. So the name
 * carries a short hash of the full host whenever the mangle could not be trusted to be unique:
 * always on truncation, and on demand when the caller has found the plain name taken by a
 * different host.
 */
export function skillNameForHost(host: string, opts: { disambiguate?: boolean } = {}): string {
  const domain = normalizeDomain(host).replace(/^www\./, '');
  const base = domain
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return `site-${fingerprint(host)}`;

  const suffix = `-${fingerprint(host)}`;
  const truncated = base.length > MAX_NAME_LENGTH - suffix.length;
  if (!truncated && !opts.disambiguate) {
    return base.length <= MAX_NAME_LENGTH ? base : base.slice(0, MAX_NAME_LENGTH).replace(/-+$/, '');
  }
  const room = MAX_NAME_LENGTH - suffix.length;
  return `${base.slice(0, room).replace(/-+$/, '')}${suffix}`;
}

const MAX_NAME_LENGTH = 48;

/** FNV-1a, inlined rather than imported — this module deliberately depends on nothing. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}

/**
 * Suffix match on a dot boundary: `example.com` covers `www.example.com` but never
 * `notexample.com` — the classic `endsWith` bug, written out so it cannot regress.
 */
export function hostMatchesDomains(host: string, domains: readonly string[]): boolean {
  return matchedDomains(host, domains).length > 0;
}

/** Every domain that matches, longest first — the daemon orders overlays by specificity. */
export function matchedDomains(host: string, domains: readonly string[]): string[] {
  const lower = host.toLowerCase();
  if (!lower) return [];
  return domains
    .filter((domain) => lower === domain || lower.endsWith(`.${domain}`))
    .sort((a, b) => b.length - a.length);
}

export type SkillValidation = { ok: true; draft: SkillDraft } | { ok: false; message: string };

/**
 * The one source of validation truth: the extension shows the message before sending, the
 * daemon re-runs it before writing. Returns a normalized draft — trimmed, lowercased, with
 * any front matter stripped from the body — so the daemon writes exactly what it validated.
 */
export function validateSkillDraft(draft: SkillDraft, opts: { reservedNames?: readonly string[] } = {}): SkillValidation {
  const name = draft.name.trim().toLowerCase();
  if (!name) return fail('Give the skill a name.');
  if (!SKILL_NAME_RE.test(name)) {
    return fail('Names use lowercase letters, digits and hyphens only, starting with a letter or digit (max 48).');
  }
  if (opts.reservedNames?.some((reserved) => reserved.toLowerCase() === name)) {
    return fail(`"${name}" is the name of a built-in skill. Pick another.`);
  }

  const description = flatten(draft.description).slice(0, MAX_DESCRIPTION);

  const category = draft.category;
  if (!SKILL_CATEGORIES.includes(category)) return fail(`Unknown category "${String(category)}".`);

  const domains = dedupe(draft.domains.map(normalizeDomain).filter(Boolean));
  if (category === 'site-exploration') {
    if (!domains.length) return fail('A site-exploration skill needs at least one domain, like acme.com.');
    if (domains.length > MAX_DOMAINS) return fail(`At most ${MAX_DOMAINS} domains.`);
    for (const domain of domains) {
      if (domain.includes('*')) return fail(`"${domain}" — wildcards are not supported; subdomains match automatically.`);
      if (!isDomain(domain)) return fail(`"${domain}" is not a domain. Use something like acme.com.`);
    }
  }

  // Domains are a site skill's trigger; a trigger list on one would only be misleading.
  const triggers =
    category === 'site-exploration'
      ? []
      : dedupe(draft.triggers.map((trigger) => flatten(trigger).toLowerCase()).filter(Boolean));
  if (triggers.length > MAX_TRIGGERS) return fail(`At most ${MAX_TRIGGERS} triggers.`);
  for (const trigger of triggers) {
    if (trigger.length < MIN_TRIGGER || trigger.length > MAX_TRIGGER) {
      return fail(`Trigger "${trigger}" must be ${MIN_TRIGGER}–${MAX_TRIGGER} characters.`);
    }
  }

  // A file that still carries its own front matter would have it parsed a second time on load.
  const body = splitFrontMatter(draft.body.replace(/\r\n/g, '\n')).body.trim();
  if (!body) return fail('The skill has no instructions — add some markdown below the front matter.');
  if (byteLength(body) > MAX_BODY_BYTES) {
    return fail(`The skill is larger than ${Math.round(MAX_BODY_BYTES / 1024)} KB. Trim it down.`);
  }

  return { ok: true, draft: { name, description, category, domains, triggers, body } };
}

/** UTF-8 byte length without TextEncoder, which is not guaranteed in every context here. */
export function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // surrogate pair — count it once and skip its low half
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Read an uploaded `.md` into a draft, prefilling from whatever front matter it already has. */
export function draftFromFile(raw: string, filename: string): SkillDraft {
  const { fields, body } = splitFrontMatter(raw.replace(/\r\n/g, '\n'));
  const fallbackName = normalizeDomain(filename.replace(/\.(md|markdown)$/i, ''))
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return {
    name: (fields.name || fallbackName).toLowerCase(),
    description: fields.description ?? '',
    category: parseCategory(fields.category),
    domains: parseList(fields.domains).map(normalizeDomain).filter(Boolean),
    triggers: parseList(fields.triggers).map((trigger) => trigger.toLowerCase()),
    body: body.trim(),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function fail(message: string): SkillValidation {
  return { ok: false, message };
}
