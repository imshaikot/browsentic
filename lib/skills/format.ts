export type SkillCategory = 'general' | 'site-exploration';

export const SKILL_CATEGORIES: readonly SkillCategory[] = ['general', 'site-exploration'];

export interface SkillDraft {
  name: string;
  description: string;
  category: SkillCategory;
  domains: string[];
  triggers: string[];
  body: string;
}

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_DOMAINS = 20;
export const MAX_TRIGGERS = 30;

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_DESCRIPTION = 300;
const MIN_TRIGGER = 3;
const MAX_TRIGGER = 60;

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

export function serializeSkillFile(draft: SkillDraft): string {
  const lines = [`name: ${flatten(draft.name)}`];
  if (draft.description) lines.push(`description: ${flatten(draft.description)}`);
  if (draft.category !== 'general') lines.push(`category: ${flatten(draft.category)}`);
  if (draft.domains.length) lines.push(`domains: [${draft.domains.map(flatten).join(', ')}]`);
  if (draft.triggers.length) lines.push(`triggers: [${draft.triggers.map(flatten).join(', ')}]`);
  return `---\n${lines.join('\n')}\n---\n\n${draft.body.replace(/\r\n/g, '\n').trim()}\n`;
}

function flatten(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

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

export function isDomain(value: string): boolean {
  return value === 'localhost' || (value.length <= 253 && DOMAIN_RE.test(value));
}

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

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 5);
}

export function hostMatchesDomains(host: string, domains: readonly string[]): boolean {
  return matchedDomains(host, domains).length > 0;
}

export function matchedDomains(host: string, domains: readonly string[]): string[] {
  const lower = host.toLowerCase();
  if (!lower) return [];
  return domains
    .filter((domain) => lower === domain || lower.endsWith(`.${domain}`))
    .sort((a, b) => b.length - a.length);
}

export type SkillValidation = { ok: true; draft: SkillDraft } | { ok: false; message: string };

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

  const body = splitFrontMatter(draft.body.replace(/\r\n/g, '\n')).body.trim();
  if (!body) return fail('The skill has no instructions — add some markdown below the front matter.');
  if (byteLength(body) > MAX_BODY_BYTES) {
    return fail(`The skill is larger than ${Math.round(MAX_BODY_BYTES / 1024)} KB. Trim it down.`);
  }

  return { ok: true, draft: { name, description, category, domains, triggers, body } };
}

export function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

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
