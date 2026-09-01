import { BookOpen, Globe, Sparkles, SquareSlash, Zap } from 'lucide-react';

import type { SkillCatalog } from '@/lib/actions/protocol';
import { AGENTS } from '@/lib/agents/catalog';
import {
  CONTEXT_COMMAND,
  CONTEXT_COMMAND_DESCRIPTION,
  REMOVE_TOOLS_COMMAND,
  REMOVE_TOOLS_DESCRIPTION,
} from '@/lib/bridge/commands';
import type { SavedToolMeta } from '@/lib/bridge/saved-tools';
import { hostMatchesDomains, hostnameOf } from '@/lib/skills/format';
import { toolMatchesUrl } from '@/lib/skills/saved-tool';
import { cn } from '@/lib/utils';

export interface SkillMenuItem {
  key: string;
  group: 'tool' | 'command' | 'site' | 'general' | 'agent' | 'other-site';
  name: string;
  description: string;
  /** Set on agent skills — choosing one attaches this id to the message instead of a text prefix. */
  agentSkillId?: string;
  /** Set on typed commands — choosing one sends this text right away instead of inserting a prefix. */
  command?: string;
  /**
   * Set on a tool the user saved. Choosing one runs its approved code in the tab there and
   * then: no agent, no daemon, no prompt, because all three already had their say when it
   * was saved.
   */
  savedToolId?: string;
}

// Saved tools sort first: they are the only entries that do something on their own, and
// the user named them, so they are the ones being looked for.
const GROUP_ORDER: Record<SkillMenuItem['group'], number> = {
  tool: 0,
  command: 1,
  site: 2,
  general: 3,
  agent: 4,
  'other-site': 5,
};

export function skillMenuItems(
  catalog: SkillCatalog | undefined,
  tabUrl: string,
  query: string,
  tools: readonly SavedToolMeta[] = [],
): SkillMenuItem[] {
  const host = hostnameOf(tabUrl);
  const items: SkillMenuItem[] = [
    {
      key: 'command:context',
      group: 'command',
      name: 'context',
      description: CONTEXT_COMMAND_DESCRIPTION,
      command: CONTEXT_COMMAND,
    },
  ];
  if (tools.length) {
    items.push({
      key: 'command:remove-tools',
      group: 'command',
      name: 'remove-tools',
      description: REMOVE_TOOLS_DESCRIPTION,
      command: REMOVE_TOOLS_COMMAND,
    });
  }
  // Only the ones that belong on this page. A tool saved for youtube.com/watch is noise
  // on the homepage, and offering it there would only produce a scope refusal.
  for (const tool of tools) {
    if (!toolMatchesUrl(tool.scope, tabUrl)) continue;
    items.push({
      key: `tool:${tool.id}`,
      group: 'tool',
      name: tool.name,
      description: tool.description,
      savedToolId: tool.id,
    });
  }
  for (const skill of catalog?.skills ?? []) {
    const group =
      skill.category !== 'site-exploration'
        ? 'general'
        : host && hostMatchesDomains(host, skill.domains)
          ? 'site'
          : 'other-site';
    items.push({ key: `${group}:${skill.name}`, group, name: skill.name, description: skill.description });
  }
  for (const skill of catalog?.agentSkills ?? []) {
    items.push({ key: `agent:${skill.id}`, group: 'agent', name: skill.name, description: skill.description, agentSkillId: skill.id });
  }
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? items.filter(
        (item) => item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle),
      )
    : items;
  return matched.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.name.localeCompare(b.name));
}

export function SkillMenu({
  items,
  agent,
  highlight,
  onHover,
  onSelect,
}: {
  items: SkillMenuItem[];
  agent: SkillCatalog['agent'] | undefined;
  highlight: number;
  onHover: (index: number) => void;
  onSelect: (item: SkillMenuItem) => void;
}) {
  const labels: Record<SkillMenuItem['group'], string> = {
    tool: 'Your tools',
    command: 'Commands',
    site: 'On this site',
    general: 'Browsentic skills',
    agent: `${agent ? AGENTS[agent].label : 'Agent'} skills`,
    'other-site': 'Other sites',
  };

  return (
    <div
      role="listbox"
      aria-label="Skills and commands"
      className="enters absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
    >
      {items.length === 0 ? (
        <p className="px-3 py-2.5 text-[11px] text-ink-faint">Nothing matches — keep typing, or press Escape.</p>
      ) : (
        items.map((item, index) => (
          <div key={item.key}>
            {(index === 0 || items[index - 1].group !== item.group) && (
              <p className="px-3 pt-2 pb-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">
                {labels[item.group]}
              </p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
                index === highlight ? 'bg-brand/12' : 'hover:bg-ground/40',
              )}
            >
              {item.group === 'tool' ? (
                <Zap className="mt-0.5 size-3 shrink-0 text-lime" />
              ) : item.group === 'command' ? (
                <SquareSlash className="mt-0.5 size-3 shrink-0 text-amber" />
              ) : item.group === 'agent' ? (
                <Sparkles className="mt-0.5 size-3 shrink-0 text-brand" />
              ) : item.group === 'general' ? (
                <BookOpen className="mt-0.5 size-3 shrink-0 text-ink-faint" />
              ) : (
                <Globe className="mt-0.5 size-3 shrink-0 text-ink-faint" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{item.name}</span>
                {item.description && (
                  <span className="block truncate text-[11px] text-ink-dim">{item.description}</span>
                )}
              </span>
            </button>
          </div>
        ))
      )}
    </div>
  );
}
