import { useEffect, useState } from 'react';
import { BookOpen, Folder, Globe, RefreshCw } from 'lucide-react';

import { Card, EmptyState, PathRow, Pill, QuietButton, SectionTitle, Spinner, type Tint } from '../components';
import type { Model, State } from '../model';
import type { Skill } from '../backend';

const SOURCE: Record<string, Tint> = { bundled: 'brand', user: 'ember' };

export function SkillsView({ model, state }: { model: Model; state: State }) {
  const [query, setQuery] = useState('');
  useEffect(() => void model.loadSkills(), [model]);

  const skills = state.skills?.skills ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? skills.filter((skill) => `${skill.name} ${skill.description} ${skill.domains.join(' ')}`.toLowerCase().includes(needle)) : skills;
  const own = state.skills?.agentSkills ?? [];

  return (
    <div className="space-y-4.5">
      <Card>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SectionTitle
                title="Skills the agent can route to"
                subtitle="Read in order: a later folder shadows an earlier one by name. Drop a folder with a SKILL.md into yours to add one."
              />
            </div>
            <QuietButton icon={RefreshCw} onClick={() => void model.loadSkills()}>
              Refresh
            </QuietButton>
          </div>
          {state.skills?.dirs.map((dir) => <PathRow key={dir} path={expand(dir, state)} model={model} info={state.info} />)}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, description or site"
            className="w-full rounded-[10px] border border-line bg-ground-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
          />
        </div>
      </Card>

      {!state.skills ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={BookOpen} title="No skill matches" detail="Clear the filter to see all of them." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((skill) => (
            <SkillTile key={`${skill.source}/${skill.name}`} skill={skill} model={model} />
          ))}
        </div>
      )}

      {own.length > 0 && (
        <Card>
          <div className="space-y-2.5">
            <SectionTitle title="The agent’s own skills" subtitle="Attachable from the side panel’s / picker." />
            {own.map((skill) => (
              <div key={skill.name} className="space-y-0.5">
                <p className="font-mono text-xs font-semibold text-ink">{skill.name}</p>
                {skill.description && <p className="line-clamp-2 text-[11.5px] text-ink-dim">{skill.description}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

const expand = (dir: string, state: State) => (dir.startsWith('~') && state.info ? `${state.info.paths.home}${dir.slice(1)}` : dir);

function SkillTile({ skill, model }: { skill: Skill; model: Model }) {
  return (
    <div className="space-y-2 rounded-[14px] border border-line bg-surface/72 p-3.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-ink">{skill.name}</span>
        {skill.isDefault && <Pill text="default" tint="lime" />}
        <Pill text={skill.provenance === 'generated' ? 'mapped' : skill.source} tint={SOURCE[skill.source] ?? 'magenta'} />
      </div>
      <p className="line-clamp-3 min-h-11 text-xs text-ink-dim">{skill.description || 'No description.'}</p>
      <div className="flex items-center gap-1.5">
        {skill.domains.slice(0, 2).map((domain) => (
          <Pill key={domain} text={domain} icon={Globe} />
        ))}
        <div className="flex-1" />
        {skill.path && (
          <button type="button" title="Show in File Explorer" className="text-ink-dim hover:text-ink" onClick={() => void model.reveal(skill.path!)}>
            <Folder className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
