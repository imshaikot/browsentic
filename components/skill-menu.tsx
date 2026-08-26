import { BookOpen, Globe, Sparkles } from 'lucide-react';

import type { SkillCatalog } from '@/lib/actions/protocol';
import { AGENTS } from '@/lib/agents/catalog';
import { hostMatchesDomains, hostnameOf } from '@/lib/skills/format';
import { cn } from '@/lib/utils';

export interface SkillMenuItem {
  key: string;
  group: 'site' | 'general' | 'agent' | 'other-site';
  name: string;
  description: string;
  /** Set on agent skills — choosing one attaches this id to the message instead of a text prefix. */
  agentSkillId?: string;
}

const GROUP_ORDER: Record<SkillMenuItem['group'], number> = { site: 0, general: 1, agent: 2, 'other-site': 3 };

export function skillMenuItems(catalog: SkillCatalog | undefined, tabUrl: string, query: string): SkillMenuItem[] {
  if (!catalog) return [];
  const host = hostnameOf(tabUrl);
  const items: SkillMenuItem[] = [];
  for (const skill of catalog.skills) {
    const group =
      skill.category !== 'site-exploration'
        ? 'general'
        : host && hostMatchesDomains(host, skill.domains)
          ? 'site'
          : 'other-site';
    items.push({ key: `${group}:${skill.name}`, group, name: skill.name, description: skill.description });
  }
  for (const skill of catalog.agentSkills) {
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
    site: 'On this site',
    general: 'Browsentic skills',
    agent: `${agent ? AGENTS[agent].label : 'Agent'} skills`,
    'other-site': 'Other sites',
  };

  return (
    <div
      role="listbox"
      aria-label="Skills"
      className="enters absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface shadow-lg"
    >
      {items.length === 0 ? (
        <p className="px-3 py-2.5 text-[11px] text-ink-faint">No skills match — keep typing, or press Escape.</p>
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
              {item.group === 'agent' ? (
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
