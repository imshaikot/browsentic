import { browser } from 'wxt/browser';
import type { SkillCategory, SkillDraft } from '@/lib/skills/format';
import { deleteSiteMap, deleteSkill, saveSkill } from './socket';

export const SKILLS_INDEX_KEY = 'voicelink:skills';

const skillBodyKey = (id: string) => `voicelink:skill:${id}`;

export type SkillSyncStatus = 'pending' | 'saved' | 'error';

export interface StoredSkillMeta {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  domains: string[];
  status: SkillSyncStatus;
  path?: string;
  error?: string;
  addedAt: number;
  origin?: 'upload' | 'generated';
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

export async function putSkill(meta: StoredSkillMeta, body: StoredSkillBody): Promise<void> {
  await browser.storage.local.set({ [skillBodyKey(meta.id)]: body });
  const list = await listSkillMeta();
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

export async function pushSkill(id: string): Promise<void> {
  const meta = (await listSkillMeta()).find((skill) => skill.id === id);
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

export async function removeSkill(id: string): Promise<void> {
  const meta = (await listSkillMeta()).find((skill) => skill.id === id);
  if (meta) await (meta.origin === 'generated' ? deleteSiteMap(meta.name) : deleteSkill(meta.name));
  await browser.storage.local.remove(skillBodyKey(id));
  const list = await listSkillMeta();
  await writeIndex(list.filter((skill) => skill.id !== id));
}

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

export async function resyncSkills(): Promise<void> {
  for (const skill of await listSkillMeta()) {
    if (skill.status !== 'saved' && skill.origin !== 'generated') await pushSkill(skill.id);
  }
}
