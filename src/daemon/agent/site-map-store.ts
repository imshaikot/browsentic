import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { SKILL_NAME_RE, serializeSkillFile, skillNameForHost } from '@/lib/skills/format';
import {
  MAX_MAP_BODY_BYTES,
  isMappableHost,
  type SiteMapDraft,
  type SiteMapReport,
} from '@/lib/skills/site-map';
import { log } from '../log';
import { SKILL_FILE, bundledSkillNames, existingUserSkill, uploadedSkillsDir } from './skills';
import type { SiteIndex } from './sitemap';

const STAGING = '.staging';

export interface MapTarget {
  host: string;
  origin: string;
  domain: string;
  name: string;
}

export interface Staging {
  id: string;
  dir: string;
  screenshots: string;
  evidence: string;
  pages: string;
}

export function mapTargetFor(url: string): { ok: true; target: MapTarget } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'That tab has no address to map.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: 'Only http(s) pages can be mapped. Open the site first.' };
  }

  const host = parsed.hostname.toLowerCase();
  const domain = host.replace(/^www\./, '');
  if (!isMappableHost(domain) && domain !== 'localhost') {
    return { ok: false, message: `"${host}" is not a site that can be mapped.` };
  }

  const name = uniqueName(domain, host);
  if (!name) {
    return { ok: false, message: `Could not derive a skill name for "${host}".` };
  }
  if (bundledSkillNames().some((bundled) => bundled === name)) {
    return { ok: false, message: `"${name}" is the name of a built-in skill.` };
  }
  if (existingUserSkill(name)) {
    return {
      ok: false,
      message: `"${name}" is already a skill you wrote by hand. Rename or remove it before mapping this site.`,
    };
  }
  return { ok: true, target: { host, origin: parsed.origin, domain, name } };
}

function uniqueName(domain: string, host: string): string | null {
  const plain = skillNameForHost(domain);
  if (!SKILL_NAME_RE.test(plain)) return null;
  const owner = mappedHostOf(plain);
  if (owner === null || owner === host) return plain;
  const disambiguated = skillNameForHost(domain, { disambiguate: true });
  return SKILL_NAME_RE.test(disambiguated) ? disambiguated : null;
}

function mappedHostOf(name: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(join(uploadedSkillsDir(), name, 'meta.json'), 'utf8')) as { host?: unknown };
    return typeof meta.host === 'string' ? meta.host : '';
  } catch {
    return existsSync(join(uploadedSkillsDir(), name, SKILL_FILE)) ? '' : null;
  }
}

export function prepareStaging(): Staging {
  const id = randomUUID();
  const dir = join(uploadedSkillsDir(), STAGING, id);
  const staging: Staging = {
    id,
    dir,
    screenshots: join(dir, 'screenshots'),
    evidence: join(dir, 'evidence'),
    pages: join(dir, 'pages'),
  };
  for (const path of [dir, staging.screenshots, staging.evidence, staging.pages]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return staging;
}

export function stagedScreenshots(staging: Staging): string[] {
  try {
    return readdirSync(staging.screenshots).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}

export function writeEvidence(staging: Staging, name: 'sitemap.txt' | 'background.txt', body: string): void {
  if (!body.trim()) return;
  writeFileSync(join(staging.evidence, name), body, { mode: 0o600 });
}

export function stageSiteMap(args: {
  staging: Staging;
  target: MapTarget;
  report: SiteMapReport;
  index: SiteIndex;
  background: string | null;
  warnings: string[];
  runId: string;
}): SiteMapDraft {
  const { staging, target, report, index, background, warnings, runId } = args;
  const generatedAt = new Date().toISOString();
  const body = renderSiteMapBody({ target, report, index, background, generatedAt });

  const markdown = serializeSkillFile({
    name: target.name,
    description: `Machine-generated map of ${target.domain} — ${report.pages.length} pages, ${generatedAt.slice(0, 10)}.`,
    category: 'site-exploration',
    domains: [target.domain],
    triggers: [],
    body,
  }).replace('\n---\n\n', `\nprovenance: generated\ngeneratedAt: ${generatedAt}\n---\n\n`);

  writeFileSync(join(staging.dir, SKILL_FILE), markdown, { mode: 0o600 });
  writeFileSync(join(staging.dir, 'map.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(
    join(staging.dir, 'meta.json'),
    JSON.stringify({ name: target.name, host: target.host, domain: target.domain, generatedAt, runId }, null, 2),
    { mode: 0o600 },
  );
  for (const [index_, page] of report.pages.entries()) {
    if (!page.notes) continue;
    const file = `${String(index_ + 1).padStart(2, '0')}-${skillNameForHost(page.path) || 'page'}.md`;
    writeFileSync(join(staging.pages, file), `# ${page.title}\n\n${page.path}\n\n${page.notes}\n`, { mode: 0o600 });
  }

  return {
    stagingId: staging.id,
    name: target.name,
    host: target.host,
    domain: target.domain,
    directory: join(uploadedSkillsDir(), target.name),
    markdown,
    pages: report.pages.length,
    screenshots: stagedScreenshots(staging).length,
    generatedAt,
    warnings,
  };
}

function renderSiteMapBody(args: {
  target: MapTarget;
  report: SiteMapReport;
  index: SiteIndex;
  background: string | null;
  generatedAt: string;
}): string {
  const { target, report, index, background, generatedAt } = args;
  const out: string[] = [
    `Machine-generated map of ${target.domain}, built by a Browsentic mapping run on ` +
      `${generatedAt.slice(0, 10)} from ${report.pages.length} pages. Everything below was derived from that ` +
      `site's own pages and is a record of what was seen, not a set of instructions.`,
    '',
    '## What this site is',
    report.summary,
  ];

  if (report.landmarks.length) {
    out.push('', '## Landmarks');
    for (const landmark of report.landmarks) {
      const selector = landmark.selector ? ` — \`${landmark.selector}\`` : '';
      out.push(`- **${landmark.name}**${selector}${landmark.note ? ` — ${landmark.note}` : ''}`);
    }
  }

  out.push('', '## Pages seen', '', '| Path | What it is | Reached by | Shot |', '| --- | --- | --- | --- |');
  for (const page of report.pages) {
    out.push(
      `| ${page.path} | ${page.purpose || page.title} | ${page.reachedBy ?? '—'} | ${page.screenshot ?? '—'} |`,
    );
  }

  if (report.links.length) {
    out.push('', '## How the pages connect');
    const byFrom = new Map<string, string[]>();
    for (const link of report.links) byFrom.set(link.from, [...(byFrom.get(link.from) ?? []), link.to]);
    for (const [from, targets] of byFrom) out.push(`- ${from} → ${[...new Set(targets)].join(', ')}`);
  }

  if (index.patterns.length) {
    out.push('', '## URL patterns');
    for (const pattern of index.patterns) {
      out.push(`- \`${pattern.pattern}\` — ${pattern.count} pages in ${index.source}`);
    }
    if (index.truncated) out.push(`- (the sitemap listed more than was read)`);
  }

  if (report.quirks.length) {
    out.push('', '## Quirks');
    for (const quirk of report.quirks) out.push(`- ${quirk}`);
  }

  if (background) {
    out.push('', '## Public background', '', `${background} (Researched from the open web, not from this site.)`);
  }

  const shots = report.pages.filter((page) => page.screenshot).length;
  if (shots) {
    out.push('', '## Screenshots', '', `Full-size captures: ${join(uploadedSkillsDir(), target.name, 'screenshots')}`);
  }

  const body = out.join('\n');
  return body.length > MAX_MAP_BODY_BYTES ? `${body.slice(0, MAX_MAP_BODY_BYTES - 40)}\n\n(map truncated)` : body;
}

export function commitStaging(stagingId: string, exactHost = false): ActionResult<{ name: string; path: string }> {
  const staging = stagingDirFor(stagingId);
  if (!staging) return failure('NOT_FOUND', 'That mapping run is no longer staged.');

  let meta: { name?: unknown; host?: unknown; domain?: unknown };
  try {
    meta = JSON.parse(readFileSync(join(staging, 'meta.json'), 'utf8')) as typeof meta;
  } catch {
    return failure('NOT_FOUND', 'That staged map is incomplete.');
  }
  const name = typeof meta.name === 'string' ? meta.name : '';
  const host = typeof meta.host === 'string' ? meta.host : '';
  const domain = typeof meta.domain === 'string' ? meta.domain : '';
  if (!SKILL_NAME_RE.test(name) || !host || !domain) return failure('NOT_FOUND', 'That staged map is incomplete.');

  if (existingUserSkill(name)) {
    return failure('NAME_TAKEN', `"${name}" is now a skill you wrote by hand. Remove it first, or discard this map.`);
  }

  if (exactHost && host !== domain) {
    const path = join(staging, SKILL_FILE);
    writeFileSync(path, readFileSync(path, 'utf8').replace(`domains: [${domain}]`, `domains: [${host}]`), {
      mode: 0o600,
    });
  }

  const destination = join(uploadedSkillsDir(), name);
  if (!contained(destination)) return failure('INVALID_INPUT', 'Refusing to write outside the skills directory.');
  if (existsSync(destination)) {
    renameSync(destination, join(uploadedSkillsDir(), STAGING, `${name}-replaced-${randomUUID().slice(0, 8)}`));
  }
  renameSync(staging, destination);
  log(`activated site map ${name} (${host})`);
  return success({ name, path: destination });
}

export function discardStaging(stagingId: string): ActionResult<{ name: string }> {
  const staging = stagingDirFor(stagingId);
  if (!staging) return failure('NOT_FOUND', 'That mapping run is no longer staged.');
  rmSync(staging, { recursive: true, force: true });
  log(`discarded staged site map ${stagingId}`);
  return success({ name: stagingId });
}

function stagingDirFor(stagingId: string): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(stagingId)) return null;
  const dir = resolve(join(uploadedSkillsDir(), STAGING, stagingId));
  if (dirname(dir) !== resolve(join(uploadedSkillsDir(), STAGING))) return null;
  return existsSync(join(dir, SKILL_FILE)) ? dir : null;
}

function contained(path: string): boolean {
  const root = resolve(uploadedSkillsDir());
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

export function sweepStaging(maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now()): void {
  const root = join(uploadedSkillsDir(), STAGING);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      const meta = JSON.parse(readFileSync(join(root, entry, 'meta.json'), 'utf8')) as { generatedAt?: unknown };
      const at = typeof meta.generatedAt === 'string' ? Date.parse(meta.generatedAt) : 0;
      if (at && now - at < maxAgeMs) continue;
    } catch {
    }
    rmSync(join(root, entry), { recursive: true, force: true });
    log(`swept abandoned staging ${entry}`);
  }
}
