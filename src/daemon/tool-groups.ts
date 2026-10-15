import { TOOL_GROUPS, type ToolGroupName } from '@/lib/actions/groups';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { actions } from '@/lib/actions/registry';
import { OPEN_SKILL_TOOL, toolNameFor } from '@/lib/actions/tool-names';
import type { Skill } from './agent/skills';

const GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroupName[];

const membersOf = (group: ToolGroupName) => [...actions.values()].filter((action) => action.group === group);

const chromiumOnly = (group: ToolGroupName) => membersOf(group).every((action) => action.chromiumOnly);

export const GROUP_INDEX = GROUP_NAMES.map(
  (group) => `- ${group}: ${TOOL_GROUPS[group].index}${chromiumOnly(group) ? ' (Chromium browsers only)' : ''}`,
).join('\n');

export const GROUPS_NOTE =
  `Less common capabilities each have a guide, opened with ${OPEN_SKILL_TOOL}: how to go about it, then its tools with their ` +
  `input schemas. Open one when the page calls for it:\n${GROUP_INDEX}`;

/** A page action the registry knows, named as an action, as its tool, or bare: page.dragElement, page_dragElement, dragElement. */
export function pageActionNamed(name: string): string | undefined {
  const action = `page.${name.trim().replace(/^page[._]/, '')}`;
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

/** The group's skills, then each of its tools this caller is offered, with the schema to call it by. */
export function groupGuide(group: ToolGroupName, offered: readonly ToolDescriptor[], skills: readonly Skill[]): ActionResult<string> {
  const members = membersOf(group).map((action) => action.name);
  const tools = offered.filter((tool) => members.includes(tool.name));
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
      'Call them by name, as you would any other tool.',
      ...tools.map((tool) => `### ${toolNameFor(tool.name)}\n${tool.description}\nInput schema: ${JSON.stringify(tool.inputSchema)}`),
      ...(missing.length ? [`Not offered in this run: ${missing.join(', ')}.`] : []),
    ].join('\n\n'),
  );
}
