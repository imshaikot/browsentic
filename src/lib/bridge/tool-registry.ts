/**
 * Keeping a tool, and letting it go again.
 *
 * Two halves that must move together and are deliberately kept apart:
 *
 *   the code      → `storage.local`, extension only. Never sent anywhere.
 *   a description → a markdown skill on the daemon, so the agent knows the tool exists
 *                   and can tell the user to reach for it.
 *
 * The daemon half carries no JavaScript at all. That is what keeps a saved tool out of an
 * MCP client's reach: the skill it can theoretically read is prose, and the only thing that
 * can execute the tool is the side panel, over a port no external caller is on.
 */

import type { SkillDraft } from '@/lib/skills/format';
import { skillNameFor, slugify } from '@/lib/skills/saved-tool';
import type { ToolOffer } from './code-toolkit';
import { deleteSkill, saveSkill } from './socket';
import {
  forgetSavedTool,
  saveTool,
  uniqueName,
  withoutCode,
  type SavedTool,
  type SavedToolMeta,
} from './saved-tools';

/** The code the panel approved, read back out of the tab's live toolkit record. */
export interface KeepRequest {
  offer: ToolOffer;
  /** The toolkit source, supplied by whatever still holds it. */
  code: string;
  /** User-editable last name segment; falls back to the suggestion on the offer. */
  slug?: string;
}

export async function keepTool(request: KeepRequest): Promise<SavedToolMeta> {
  const { offer, code } = request;
  const scope = { host: offer.host, segment: offer.segment };
  const slug = slugify(request.slug ?? '') || offer.suggestedSlug;
  const name = await uniqueName(scope, slug);

  const tool: SavedTool = {
    id: crypto.randomUUID(),
    name,
    skillName: skillNameFor(scope, slug),
    description: offer.purpose,
    scope,
    origin: offer.origin,
    code,
    fn: offer.fn,
    createdAt: Date.now(),
  };

  await saveTool(tool);
  // Best effort: the tool works from `/` whether or not the daemon is up to hear about it.
  await saveSkill(skillFor(tool)).catch(() => undefined);
  return withoutCode(tool);
}

export async function dropTool(id: string): Promise<SavedToolMeta | null> {
  const gone = await forgetSavedTool(id);
  if (gone) await deleteSkill(gone.skillName).catch(() => undefined);
  return gone;
}

/**
 * The markdown the daemon gets. It describes the tool and says who may run it, because an
 * agent that tried would only find there is no action for it — better to say so plainly
 * than to let it discover that by failing.
 */
function skillFor(tool: SavedTool): SkillDraft {
  const where = tool.scope.segment === 'root' ? tool.scope.host : `${tool.scope.host}/${tool.scope.segment}`;
  return {
    name: tool.skillName,
    description: `Saved tool on ${where}: ${tool.description}`,
    category: 'site-exploration',
    domains: [tool.scope.host],
    triggers: [tool.name, tool.scope.host],
    body: [
      `# ${tool.name}`,
      '',
      `The user saved a tool for **${where}**, out of page code they read and approved:`,
      '',
      `> ${tool.description}`,
      '',
      '## How it runs',
      '',
      `It runs from the side panel, by typing \`/${tool.name}\`. It is already approved, so it`,
      'needs no further permission and costs no round trip.',
      '',
      '## What you should do',
      '',
      'You cannot call it yourself: it is not a page action, and its code lives in the extension',
      'rather than here. If the user asks for this on this page, tell them the tool exists and to',
      `run \`/${tool.name}\`, rather than writing the same thing again with page.injectCode.`,
      '',
      'If they want it changed, write fresh code with page.injectCode as usual and let them save',
      'that over the old one.',
    ].join('\n'),
  };
}

