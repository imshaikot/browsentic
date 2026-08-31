import { BookOpen, Globe, Sparkles, SquareSlash } from 'lucide-react';

import type { SkillCatalog } from '@/lib/actions/protocol';
import { AGENTS } from '@/lib/agents/catalog';
import { CONTEXT_COMMAND, CONTEXT_COMMAND_DESCRIPTION } from '@/lib/bridge/commands';
import { hostMatchesDomains, hostnameOf } from '@/lib/skills/format';
import { cn } from '@/lib/utils';

export interface SkillMenuItem {
  key: string;
  group: 'command' | 'site' | 'general' | 'agent' | 'other-site';
  name: string;
  description: string;
  /** Set on agent skills — choosing one attaches this id to the message instead of a text prefix. */
  agentSkillId?: string;
  /** Set on typed commands — choosing one sends this text right away instead of inserting a prefix. */
  command?: string;
}

const GROUP_ORDER: Record<SkillMenuItem['group'], number> = {
  command: 0,
  site: 1,
  general: 2,
  agent: 3,
  'other-site': 4,
};

export function skillMenuItems(catalog: SkillCatalog | undefined, tabUrl: string, query: string): SkillMenuItem[] {
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
              {item.group === 'command' ? (
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
