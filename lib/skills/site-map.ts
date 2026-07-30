import { byteLength, isDomain } from './format';
import { clip, looksLikeSelector, scrub, looksLikeInstruction } from './scrub';

export { scrub, looksLikeInstruction };

export const SITE_MAPPER_SKILL = 'site-mapper';

export const SAVE_SITE_MAP_ACTION = 'voicelink.saveSiteMap';

export const MAX_MAP_BODY_BYTES = 16 * 1024;
export const MAX_MAP_PAGES = 24;
export const MAX_MAP_SHOTS = 24;
export const MAX_MAP_LANDMARKS = 12;
export const MAX_MAP_PATTERNS = 12;
export const MAX_MAP_QUIRKS = 8;
export const MAX_MAP_EDGES = 60;

export const MAX_AUTHORED_BYTES = 8 * 1024;

export const FIELD_LIMITS = {
  summary: 400,
  title: 60,
  reachedBy: 60,
  purpose: 120,
  landmarkName: 60,
  landmarkNote: 160,
  quirk: 160,
  notes: 200,
} as const;

export interface SiteMapReport {
  summary: string;
  landmarks: { name: string; selector: string; note?: string }[];
  pages: { path: string; title: string; purpose: string; reachedBy?: string; screenshot?: string; notes?: string }[];
  links: { from: string; to: string }[];
  quirks: string[];
}

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
  warnings: string[];
}

export type SiteMapValidation =
  | { ok: true; report: SiteMapReport; warnings: string[] }
  | { ok: false; message: string };

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

function samePath(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const base = new URL(origin);
    const url = new URL(value.trim(), origin);
    if (url.origin !== base.origin) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return clip(`${url.pathname}${url.search}`, 160);
  } catch {
    return '';
  }
}

function basename(value: unknown): string {
  return typeof value === 'string' ? value.split('/').pop()!.trim() : '';
}

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

function trimToBudget(report: SiteMapReport, warnings: string[]): void {
  if (promptBytes(report) <= MAX_AUTHORED_BYTES) return;

  const shed = (label: string, cut: () => void) => {
    if (promptBytes(report) <= MAX_AUTHORED_BYTES) return;
    cut();
    warnings.push(`The map was over its size budget, so ${label} was left out.`);
  };

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

  while (promptBytes(report) > MAX_AUTHORED_BYTES && report.pages.length > 1) {
    const dropped = report.pages.pop()!;
    report.links = report.links.filter((link) => link.from !== dropped.path && link.to !== dropped.path);
  }
  if (report.pages.length === 1) warnings.push('Only the first page fitted in the map.');
}

export function isMappableHost(host: string): boolean {
  return isDomain(host);
}
