import { byteLength, isDomain } from './format';

/**
 * The site-map report format: what a mapping run is allowed to say about a site, and how much
 * of it survives into a skill.
 *
 * Shared because both ends need the same numbers — the daemon enforces them, the review sheet
 * explains them. Imports only `./format`, which itself imports nothing, so this still loads in
 * a worker and in bare Node.
 *
 * Everything here exists because a generated skill is a *system prompt* assembled from text an
 * agent read on a website. The daemon owns every heading and every front-matter key; the model
 * only fills fixed-width slots. These caps are what "fixed-width" means.
 */

/** The bundled skill whose identity turns on mapping mode. */
export const SITE_MAPPER_SKILL = 'site-mapper';

/** The one reserved action a mapping run may call. Intercepted before it can reach a tab. */
export const SAVE_SITE_MAP_ACTION = 'voicelink.saveSiteMap';

/**
 * The rendered document. Comfortably above what a full map costs — headings, the page table and
 * the link list are the daemon's own bytes on top of the authored budget below — so a thorough
 * crawl renders whole rather than being cut off mid-table. Still a small fraction of the 64 KB
 * whole-prompt cap that `buildSystemPrompt` enforces.
 */
export const MAX_MAP_BODY_BYTES = 16 * 1024;
export const MAX_MAP_PAGES = 24;
export const MAX_MAP_SHOTS = 24;
export const MAX_MAP_LANDMARKS = 12;
export const MAX_MAP_PATTERNS = 12;
export const MAX_MAP_QUIRKS = 8;
export const MAX_MAP_EDGES = 60;

/**
 * The total budget for model-chosen text that reaches a prompt, summed across every slot below.
 * Separate from MAX_MAP_BODY_BYTES, which also covers the headings, paths and table structure
 * the daemon wrote — the point of a distinct ceiling is to bound specifically the part an
 * attacker could shape.
 *
 * Derived from the per-field caps rather than guessed: a maximal map is ~10 KB of authored text
 * (12 landmarks, 24 pages, 8 quirks), so 8 KB fits a thorough crawl while still forcing a very
 * wordy one to shed detail. `notes` is excluded — it never leaves `pages/`. Going over trims
 * (see `trimToBudget`) rather than failing: rejecting costs the user the whole crawl.
 */
export const MAX_AUTHORED_BYTES = 8 * 1024;

/** Per-field caps. Enforced always — never only in a degradation ladder that a small map skips. */
export const FIELD_LIMITS = {
  summary: 400,
  title: 60,
  reachedBy: 60,
  purpose: 120,
  landmarkName: 60,
  landmarkNote: 160,
  quirk: 160,
  /** Never reaches a prompt — written to `pages/` — so it may be longer, but still bounded. */
  notes: 200,
} as const;

/**
 * A CSS selector shape conservative enough that it cannot carry prose. Covers the full
 * combinator set — including `,`, which makes a selector *list* (`#a, #b`) legal, and whose
 * absence rejected perfectly ordinary selectors. Backtick is deliberately excluded: the
 * renderer puts selectors in a code span, and one would break out of it.
 */
const SELECTOR_RE = /^[a-zA-Z0-9 .#>+~*,_:[\]="'()-]{1,120}$/;

/**
 * The charset alone accepts an English sentence, since prose is letters and spaces. A selector
 * has a handful of space-separated parts; a sentence has many. Counting them is the cheap
 * discriminator with no false positives — `header nav[aria-label="Main"]` is two.
 */
const MAX_SELECTOR_PARTS = 8;

function looksLikeSelector(value: string): boolean {
  return SELECTOR_RE.test(value) && value.trim().split(/\s+/).length <= MAX_SELECTOR_PARTS;
}

/** What the agent submits through `voicelink.saveSiteMap`. */
export interface SiteMapReport {
  summary: string;
  landmarks: { name: string; selector: string; note?: string }[];
  pages: { path: string; title: string; purpose: string; reachedBy?: string; screenshot?: string; notes?: string }[];
  /** Edges of the navigation graph, as paths. */
  links: { from: string; to: string }[];
  quirks: string[];
}

/** What the daemon hands the panel for review. `markdown` is rendered literally, never as HTML. */
export interface SiteMapDraft {
  stagingId: string;
  name: string;
  host: string;
  domain: string;
  directory: string;
  markdown: string;
  pages: number;
  screenshots: number;
  generatedAt: string;
  /** Advisory notes for the reviewer — never a rejection reason. */
  warnings: string[];
}

export type SiteMapValidation =
  | { ok: true; report: SiteMapReport; warnings: string[] }
  | { ok: false; message: string };

/**
 * Normalize and bound a submitted report.
 *
 * Every string is flattened to one line and stripped of the characters that would let it open a
 * heading, a list item, a quote or a table row — the model fills cells, it does not get to
 * restructure the document. Paths are re-parsed against the mapped origin by the caller; a path
 * that does not belong is dropped rather than rejected, so one bad row cannot lose a whole map.
 */
export function validateSiteMapReport(
  input: unknown,
  opts: { origin: string; screenshots: readonly string[] },
): SiteMapValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'The report must be an object.' };
  const raw = input as Partial<SiteMapReport>;
  const warnings: string[] = [];

  const summary = scrub(raw.summary ?? '', FIELD_LIMITS.summary);
  if (!summary) return { ok: false, message: 'The report needs a summary of what the site is.' };

  const landmarks = (Array.isArray(raw.landmarks) ? raw.landmarks : [])
    .slice(0, MAX_MAP_LANDMARKS)
    .map((landmark) => ({
      name: scrub(landmark?.name ?? '', FIELD_LIMITS.landmarkName),
      selector: typeof landmark?.selector === 'string' ? landmark.selector.trim() : '',
      note: scrub(landmark?.note ?? '', FIELD_LIMITS.landmarkNote) || undefined,
    }))
    .filter((landmark) => {
      if (!landmark.name) return false;
      if (landmark.selector && !looksLikeSelector(landmark.selector)) {
        warnings.push(`Dropped a landmark selector that did not look like a selector: ${clip(landmark.selector, 40)}`);
        landmark.selector = '';
      }
      return true;
    });

  const seenPaths = new Set<string>();
  const pages = (Array.isArray(raw.pages) ? raw.pages : [])
    .slice(0, MAX_MAP_PAGES)
    .map((page) => ({
      path: samePath(page?.path ?? '', opts.origin),
      title: scrub(page?.title ?? '', FIELD_LIMITS.title),
      purpose: scrub(page?.purpose ?? '', FIELD_LIMITS.purpose),
      reachedBy: scrub(page?.reachedBy ?? '', FIELD_LIMITS.reachedBy) || undefined,
      // A screenshot reference is only honoured when the daemon actually wrote that file, so
      // the "## Screenshots" section is true by construction rather than by the model's word.
      screenshot: opts.screenshots.includes(basename(page?.screenshot ?? '')) ? basename(page!.screenshot!) : undefined,
      notes: scrub(page?.notes ?? '', FIELD_LIMITS.notes) || undefined,
    }))
    .filter((page) => {
      if (!page.path || !page.title) return false;
      if (seenPaths.has(page.path)) return false;
      seenPaths.add(page.path);
      return true;
    });
  if (!pages.length) return { ok: false, message: 'The report lists no pages on the mapped site.' };

  const links = (Array.isArray(raw.links) ? raw.links : [])
    .slice(0, MAX_MAP_EDGES)
    .map((link) => ({ from: samePath(link?.from ?? '', opts.origin), to: samePath(link?.to ?? '', opts.origin) }))
    .filter((link) => link.from && link.to && link.from !== link.to);

  const quirks = (Array.isArray(raw.quirks) ? raw.quirks : [])
    .slice(0, MAX_MAP_QUIRKS)
    .map((quirk) => scrub(quirk, FIELD_LIMITS.quirk))
    .filter(Boolean);

  const report: SiteMapReport = { summary, landmarks, pages, links, quirks };
  trimToBudget(report, warnings);

  for (const text of promptStrings(report)) {
    if (looksLikeInstruction(text)) {
      warnings.push(`Reads like an instruction rather than an observation: “${clip(text, 80)}”`);
    }
  }
  return { ok: true, report, warnings };
}

/**
 * Flatten to a single line and strip the characters that begin a markdown block, so a value can
 * only ever be the contents of the cell it was put in. Never rejects — a scrubbed empty string
 * simply drops the field.
 */
export function scrub(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n\t]+/g, ' ')
    // Control characters, zero-width marks and bidi overrides — all invisible in a review
    // sheet, so text could read one way to the reviewer and another way to the model.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/^[\s#>*\-+|`~=]+/, '')
    .replace(/[`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * An advisory smell test for the reviewer, not a filter. It catches the blunt cases — text that
 * addresses the reader as an agent — and deliberately claims nothing about the subtle ones: a
 * plausible false *fact* about a site is indistinguishable from a true one and no regex reaches it.
 */
export function looksLikeInstruction(text: string): boolean {
  return /\b(?:ignore (?:all |any )?previous|disregard (?:the |all )?(?:above|previous)|you (?:must|should|will) (?:now|always|never)|instead(?:,)? (?:navigate|go|send|email|transfer|click)|do not tell|without asking|system prompt|new instructions?)\b/i.test(
    text,
  );
}

/** The path of a URL that belongs to the mapped origin, or '' when it does not. */
function samePath(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const base = new URL(origin);
    const url = new URL(value.trim(), origin);
    if (url.origin !== base.origin) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    // Re-serialized from the parsed URL, so nothing survives that a URL cannot contain.
    return clip(`${url.pathname}${url.search}`, 160);
  } catch {
    return '';
  }
}

function basename(value: unknown): string {
  return typeof value === 'string' ? value.split('/').pop()!.trim() : '';
}

/**
 * Every string the model chose that actually reaches a system prompt.
 *
 * `notes` is deliberately absent: it is written to `pages/` and never rendered into the body, so
 * budgeting it against the prompt would charge for text no prompt ever sees — which is what made
 * a thorough map fail at the last step after a ten-minute crawl.
 */
function promptStrings(report: SiteMapReport): string[] {
  return [
    report.summary,
    ...report.landmarks.flatMap((l) => [l.name, l.note ?? '']),
    ...report.pages.flatMap((p) => [p.title, p.purpose, p.reachedBy ?? '']),
    ...report.quirks,
  ].filter(Boolean);
}

function promptBytes(report: SiteMapReport): number {
  return promptStrings(report).reduce((total, text) => total + byteLength(text), 0);
}

/**
 * Fit the report to the budget by shedding detail, in order of what a future reader can most
 * afford to lose. A map that is slightly too wordy is a normal outcome of a thorough crawl, and
 * rejecting it would throw away the whole run — so this always succeeds, and says what it cut.
 *
 * Pages are dropped last and only as a backstop: they are the map.
 */
function trimToBudget(report: SiteMapReport, warnings: string[]): void {
  if (promptBytes(report) <= MAX_AUTHORED_BYTES) return;

  const shed = (label: string, cut: () => void) => {
    if (promptBytes(report) <= MAX_AUTHORED_BYTES) return;
    cut();
    warnings.push(`The map was over its size budget, so ${label} was left out.`);
  };

  // Supporting detail first — the landmark still names itself, the page still says what it is.
  shed('extra detail about each landmark', () => {
    for (const landmark of report.landmarks) landmark.note = undefined;
  });
  shed('how each page was reached', () => {
    for (const page of report.pages) page.reachedBy = undefined;
  });
  shed('the longer page descriptions', () => {
    for (const page of report.pages) page.purpose = clip(page.purpose, 60);
  });
  shed('some of the quirks', () => {
    report.quirks = report.quirks.slice(0, 3);
  });

  // Last resort: the structure survives even if the tail of it does not.
  while (promptBytes(report) > MAX_AUTHORED_BYTES && report.pages.length > 1) {
    const dropped = report.pages.pop()!;
    report.links = report.links.filter((link) => link.from !== dropped.path && link.to !== dropped.path);
  }
  if (report.pages.length === 1) warnings.push('Only the first page fitted in the map.');
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Guard for the daemon: a mapped host must be a real domain before anything is written for it. */
export function isMappableHost(host: string): boolean {
  return isDomain(host);
}
