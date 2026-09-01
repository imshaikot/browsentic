/**
 * Tools the user kept: the JavaScript half.
 *
 * This is the only place an approved toolkit's source lives once it is saved, and it is
 * deliberately `storage.local` in the extension — not the daemon, not the page, not the
 * skills directory. The daemon gets a markdown note that such a tool exists so the agent
 * can mention it; it never gets the code, so nothing an MCP client can reach ever holds a
 * line of it.
 *
 * A saved tool runs without a guardrail prompt. That exemption is the point (the code was
 * read and approved at save time) and it is why the record pins both the origin it was
 * approved on and the scope it may be offered in: the run path re-checks both before it
 * installs anything.
 */

import { browser } from 'wxt/browser';
import { displayName, scopeOf, toolMatchesUrl, type ToolScope } from '@/lib/skills/saved-tool';

const TOOLS_KEY = 'browsentic/savedTools';

/** A guard on the store, not a product limit — a slash menu stops being a menu long before this. */
export const MAX_SAVED_TOOLS = 100;

export interface SavedTool {
  id: string;
  /** `youtube.com:watch:darken-page-except-video-player`. Shown, typed, never made a path. */
  name: string;
  /** The daemon's skill file for this tool, so removal can unlink the right one. */
  skillName: string;
  description: string;
  scope: ToolScope;
  /** The full origin the code was approved on. Re-checked before every run. */
  origin: string;
  /** The approved source. Never leaves the extension. */
  code: string;
  /** The zero-argument entry point `/` invokes. */
  fn: string;
  createdAt: number;
}

/** Everything but the code: what the panel renders and what may cross a message boundary. */
export type SavedToolMeta = Omit<SavedTool, 'code'>;

export const withoutCode = ({ code: _code, ...meta }: SavedTool): SavedToolMeta => meta;

export async function listSavedTools(): Promise<SavedTool[]> {
  const stored = await browser.storage.local.get(TOOLS_KEY);
  const held = stored[TOOLS_KEY];
  return Array.isArray(held) ? (held as SavedTool[]) : [];
}

export async function savedToolsFor(url: string): Promise<SavedToolMeta[]> {
  const tools = await listSavedTools();
  return tools.filter((tool) => toolMatchesUrl(tool.scope, url)).map(withoutCode);
}

export async function getSavedTool(id: string): Promise<SavedTool | null> {
  return (await listSavedTools()).find((tool) => tool.id === id) ?? null;
}

export async function saveTool(tool: SavedTool): Promise<void> {
  const tools = await listSavedTools();
  // Same name on the same scope replaces rather than accumulates: saving twice from the
  // same page is a correction, not a second tool.
  const kept = tools.filter((held) => held.name !== tool.name);
  await browser.storage.local.set({ [TOOLS_KEY]: [tool, ...kept].slice(0, MAX_SAVED_TOOLS) });
}

export async function forgetSavedTool(id: string): Promise<SavedToolMeta | null> {
  const tools = await listSavedTools();
  const going = tools.find((tool) => tool.id === id);
  if (!going) return null;
  await browser.storage.local.set({ [TOOLS_KEY]: tools.filter((tool) => tool.id !== id) });
  return withoutCode(going);
}

/**
 * A name that does not collide with what is already saved on this scope. The suffix is
 * numeric rather than a uuid because the whole point of the name is that it can be typed.
 */
export async function uniqueName(scope: ToolScope, slug: string): Promise<string> {
  const taken = new Set((await listSavedTools()).map((tool) => tool.name));
  const base = displayName(scope, slug);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** The origin a tool may run on, recomputed from the live tab rather than trusted from the record. */
export function scopeMatches(tool: SavedTool, url: string | undefined): boolean {
  if (!url) return false;
  const here = scopeOf(url);
  if (!here) return false;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return origin === tool.origin && toolMatchesUrl(tool.scope, url);
}
