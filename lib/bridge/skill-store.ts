import { browser } from 'wxt/browser';
import type { SkillCategory, SkillDraft } from '@/lib/skills/format';
import { deleteSiteMap, deleteSkill, saveSkill } from './socket';

/**
 * The extension's library of uploaded skills, kept in `browser.storage.local`. This is the
 * durable copy: the daemon's `~/voicelink/skills/*.md` is a projection of it, rewritten
 * whenever a record has not reached disk yet, so an upload made while the daemon was down
 * still lands, and a wiped state directory can be refilled.
 *
 * Split into two shapes, like the file store, so patching a sync status never rewrites the
 * body — the index is what fans out to every open panel through `storage.onChanged`.
 *
 *   'voicelink:skills'      -> StoredSkillMeta[]   the small, reactive index the UI reads
 *   'voicelink:skill:<id>'  -> StoredSkillBody     the markdown, read only when pushing
 */

/** The reactive metadata index — never holds skill bodies. */
export const SKILLS_INDEX_KEY = 'voicelink:skills';

const skillBodyKey = (id: string) => `voicelink:skill:${id}`;

/** Whether this record has reached the daemon's disk yet. */
export type SkillSyncStatus = 'pending' | 'saved' | 'error';

export interface StoredSkillMeta {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  domains: string[];
  status: SkillSyncStatus;
  /** Where the daemon wrote it — the only ground truth about which HOME it landed in. */
  path?: string;
  /** Present when the daemon refused it. */
  error?: string;
  addedAt: number;
  /**
   * `generated` marks a site map: the daemon wrote it, its body lives on disk rather than here,
   * and it is removed by its own op. Absent on records written before mapping existed, which are
   * all uploads.
   */
  origin?: 'upload' | 'generated';
  /** Pages a map covers. Display only. */
  pages?: number;
}

export interface StoredSkillBody {
  id: string;
  body: string;
  triggers: string[];
}

export async function listSkillMeta(): Promise<StoredSkillMeta[]> {
  const stored = await browser.storage.local.get(SKILLS_INDEX_KEY);
  const list = stored[SKILLS_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredSkillMeta[]) : [];
}

async function writeIndex(list: StoredSkillMeta[]): Promise<void> {
  await browser.storage.local.set({ [SKILLS_INDEX_KEY]: list });
}

/** Store a skill: its body under its own key, its metadata at the head of the index. */
export async function putSkill(meta: StoredSkillMeta, body: StoredSkillBody): Promise<void> {
  await browser.storage.local.set({ [skillBodyKey(meta.id)]: body });
  const list = await listSkillMeta();
  // Replace by name as well as id: two uploads of the same name are one file on disk, so the
  // older record has to go — along with its body, which nothing would reach again.
  const superseded = list.filter((skill) => skill.id !== meta.id && skill.name === meta.name);
  if (superseded.length) await browser.storage.local.remove(superseded.map((skill) => skillBodyKey(skill.id)));
  await writeIndex([meta, ...list.filter((skill) => skill.id !== meta.id && skill.name !== meta.name)]);
}

export async function readSkillBody(id: string): Promise<StoredSkillBody | null> {
  const key = skillBodyKey(id);
  const stored = await browser.storage.local.get(key);
  const body = stored[key] as StoredSkillBody | undefined;
  return body && typeof body.body === 'string' ? body : null;
}

export async function updateSkillMeta(id: string, patch: Partial<StoredSkillMeta>): Promise<void> {
  const list = await listSkillMeta();
  await writeIndex(list.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)));
}

/**
 * Push one stored skill to the daemon and fold the answer back into the index. Called from the
 * background worker (it owns the socket), so the result lands even if the panel that asked has
 * closed — the same fire-and-forget shape as analyzing a file.
 */
export async function pushSkill(id: string): Promise<void> {
  const meta = (await listSkillMeta()).find((skill) => skill.id === id);
  // A generated map has no body here — the daemon wrote it, and this index is only a pointer.
  if (meta?.origin === 'generated') return;
  const stored = await readSkillBody(id);
  if (!meta || !stored) {
    await updateSkillMeta(id, { status: 'error', error: 'The skill is missing from storage.' });
    return;
  }
  const draft: SkillDraft = {
    name: meta.name,
    description: meta.description,
    category: meta.category,
    domains: meta.domains,
    triggers: stored.triggers,
    body: stored.body,
  };
  const result = await saveSkill(draft);
  if (result.ok) {
    await updateSkillMeta(id, { status: 'saved', path: result.data.path, error: undefined });
  } else {
    await updateSkillMeta(id, { status: 'error', error: `${result.error.code}: ${result.error.message}` });
  }
}

/**
 * Remove a skill here and on the daemon. The local record goes either way: a user who removes
 * a skill while the daemon is down should not find it back in the list, and a file left behind
 * is visible in `voicelink-mcp skills`.
 */
export async function removeSkill(id: string): Promise<void> {
  const meta = (await listSkillMeta()).find((skill) => skill.id === id);
  // Two different objects on disk, so two different ops: `deleteSkill` removes a flat `.md` and
  // a map's directory survives it, which is what stops removing an upload from taking a
  // same-named map's screenshots down with it.
  if (meta) await (meta.origin === 'generated' ? deleteSiteMap(meta.name) : deleteSkill(meta.name));
  await browser.storage.local.remove(skillBodyKey(id));
  const list = await listSkillMeta();
  await writeIndex(list.filter((skill) => skill.id !== id));
}

/**
 * Note a map the daemon just activated, so it shows in the panel beside uploads. Metadata only —
 * the body is on disk and is never mirrored here, so nothing can re-push and overwrite it.
 */
export async function recordGeneratedSkill(draft: {
  name: string;
  domain: string;
  directory: string;
  pages: number;
  generatedAt: string;
}): Promise<void> {
  const list = await listSkillMeta();
  const meta: StoredSkillMeta = {
    id: crypto.randomUUID(),
    name: draft.name,
    description: `Mapped ${draft.domain} — ${draft.pages} pages.`,
    category: 'site-exploration',
    domains: [draft.domain],
    status: 'saved',
    path: draft.directory,
    addedAt: Date.parse(draft.generatedAt) || Date.now(),
    origin: 'generated',
    pages: draft.pages,
  };
  await writeIndex([meta, ...list.filter((skill) => skill.name !== draft.name)]);
}

/**
 * On reconnect, push only what has not reached disk. Re-pushing everything would rewrite every
 * file on every reconnect — and the worker redials on a one-minute alarm.
 */
export async function resyncSkills(): Promise<void> {
  for (const skill of await listSkillMeta()) {
    if (skill.status !== 'saved' && skill.origin !== 'generated') await pushSkill(skill.id);
  }
}
