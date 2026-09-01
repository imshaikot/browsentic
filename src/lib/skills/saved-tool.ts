/**
 * Naming and matching for tools the user saved out of an approved live toolkit.
 *
 * Two names, deliberately. The display name is what the user typed `/` to find and reads
 * in a list: `youtube.com:watch:darken-page-except-video-player`, host first because that
 * is how you remember where a tool belongs. The daemon's copy is a skill file, and a skill
 * name reaches `join(skillsDir, name + '.md')`, so it goes through SKILL_NAME_RE like every
 * other one rather than carrying a user-shaped string into a path.
 *
 * Scope is host plus the first path segment. A tool made on /watch offers itself on every
 * /watch page and nowhere else on the host, which is the granularity real sites are built
 * at: the segment names the kind of page, and everything after it names which one.
 */

import { SKILL_NAME_RE } from './format';

export const ROOT_SEGMENT = 'root';

/** Long enough for three readable parts, short enough to sit in a menu row. */
const MAX_SLUG = 48;

export interface ToolScope {
  /** Hostname, lowercased, without a leading `www.`. */
  host: string;
  /** First path segment, or ROOT_SEGMENT for `/`. */
  segment: string;
}

export function scopeOf(url: string): ToolScope | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  const [first = ''] = parsed.pathname.split('/').filter(Boolean);
  return { host, segment: slugify(first) || ROOT_SEGMENT };
}

/** `youtube.com:watch:darken-page-except-video-player`. */
export function displayName(scope: ToolScope, slug: string): string {
  return `${scope.host}:${scope.segment}:${slug}`;
}

/**
 * A tool is offered when the tab is on the same host and the same first path segment.
 * Everything deeper varies per record (`/orders/1234`) and must not narrow the match.
 */
export function toolMatchesUrl(scope: ToolScope, url: string): boolean {
  const here = scopeOf(url);
  return !!here && here.host === scope.host && here.segment === scope.segment;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

/**
 * Turn a purpose sentence into the last name segment. Stop words go first so
 * "Darken the page except the video player" reads as the thing it does.
 */
const STOP = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'the', 'this', 'to', 'with']);

export function slugFromPurpose(purpose: string, fallback: string): string {
  const words = purpose
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter((word) => word && !STOP.has(word));
  return slugify(words.join('-')) || slugify(fallback) || 'tool';
}

/**
 * The daemon-side skill name. Derived, sanitised and length-capped, because this one
 * becomes a filename. Never build a path from `displayName`.
 */
export function skillNameFor(scope: ToolScope, slug: string): string {
  const base = slugify(`tool-${scope.host}-${scope.segment}-${slug}`).slice(0, 48).replace(/-+$/, '');
  return SKILL_NAME_RE.test(base) ? base : `tool-${slugify(slug).slice(0, 42)}`;
}

export function isSavedToolSkill(name: string): boolean {
  return name.startsWith('tool-') && SKILL_NAME_RE.test(name);
}
