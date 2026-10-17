import { TOOL_GROUPS, type ToolGroupName } from '@/lib/actions/groups';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { actions } from '@/lib/actions/registry';
import { OPEN_SKILL_TOOL, toolNameFor, USE_TOOL } from '@/lib/actions/tool-names';
import type { Skill } from './agent/skills';
import type { Described, ToolDelivery } from './control';

const GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroupName[];

const membersOf = (group: ToolGroupName) => [...actions.values()].filter((action) => action.group === group);

const chromiumOnly = (group: ToolGroupName) => membersOf(group).every((action) => action.chromiumOnly);

export const GROUP_INDEX = GROUP_NAMES.map(
  (group) => `- ${group}: ${TOOL_GROUPS[group].index}${chromiumOnly(group) ? ' (Chromium browsers only)' : ''}`,
).join('\n');

export const GROUPS_NOTE =
  `Less common capabilities each have a guide, opened with ${OPEN_SKILL_TOOL}: how to go about it, then its tools with their ` +
  `input schemas. Open one when the page calls for it:\n${GROUP_INDEX}`;

export const grouped = (action: string) => actions.get(action)?.group !== undefined;

/**
 * A page action the registry knows, named as an action, as its tool, bare, or as an agent CLI shows
 * its tool: page.dragElement, page_dragElement, dragElement, mcp__browsentic__page_dragElement.
 */
export function pageActionNamed(name: string): string | undefined {
  const action = `page.${name
    .trim()
    .replace(/^(?:mcp__)?browsentic_{1,2}/, '')
    .replace(/^page[._]/, '')}`;
  return actions.has(action) ? action : undefined;
}

/** A group named as itself, by one of its skills, or by one of its actions. */
export function groupNamed(name: string): ToolGroupName | undefined {
  const wanted = name.trim();
  const action = pageActionNamed(wanted);
  return GROUP_NAMES.find(
    (group) =>
      group === wanted.toLowerCase() ||
      (TOOL_GROUPS[group].skills as readonly string[]).includes(wanted) ||
      (action !== undefined && actions.get(action)?.group === group),
  );
}

export interface GroupListing {
  name: ToolGroupName;
  /** Its index line, led by its name, which is what a search for it matches. */
  description: string;
  tools: ToolDescriptor[];
}

/** These tools by the group each belongs to, in index order; ungrouped ones are left out. */
export function groupsOf(tools: readonly ToolDescriptor[]): GroupListing[] {
  return GROUP_NAMES.map((group) => ({
    name: group,
    description: `${group}: ${TOOL_GROUPS[group].index}`,
    tools: tools.filter((tool) => actions.get(tool.name)?.group === group),
  })).filter((group) => group.tools.length);
}

const howToCall = (group: ToolGroupName, first: string, delivery: ToolDelivery) =>
  ({
    listed: 'Call them by name, as you would any other tool.',
    'on-demand': `They are not in your tool list. Call each through ${USE_TOOL}, its name as action and its parameters as input: {"action": "${first}", "input": {...}}.`,
    namespaced: `They load when you search for them: tool_search with "${group}" loads them all, then call each by name. Inside exec they are tools.${group}__<tool>, such as tools.${group}__${first}.`,
  })[delivery];

/** The group's skills, then each of its tools this caller is offered, with the schema to call it by, and how to call it. */
export function groupGuide(group: ToolGroupName, offer: Described, skills: readonly Skill[]): ActionResult<string> {
  const members = membersOf(group).map((action) => action.name);
  const tools = offer.tools.filter((tool) => members.includes(tool.name));
  const missing = members.filter((name) => !tools.some((tool) => tool.name === name)).map(toolNameFor);
  if (!tools.length) {
    return failure(
      'UNAVAILABLE',
      `None of the ${group} tools are offered in this run${chromiumOnly(group) ? '; they run only in a Chromium browser such as Chrome or Edge, on a computer' : ''}.`,
    );
  }

  const bodies = TOOL_GROUPS[group].skills.flatMap((name) => skills.find((skill) => skill.name === name)?.body.trim() ?? []);
  return success(
    [
      `# The ${group} guide`,
      ...bodies,
      '## Its tools',
      howToCall(group, toolNameFor(tools[0].name), tools.some((tool) => offer.onDemand?.includes(tool.name)) ? (offer.delivery ?? 'on-demand') : 'listed'),
      ...tools.map((tool) => `### ${toolNameFor(tool.name)}\n${tool.description}\nInput schema: ${JSON.stringify(tool.inputSchema)}`),
      ...(missing.length ? [`Not offered in this run: ${missing.join(', ')}.`] : []),
    ].join('\n\n'),
  );
}
