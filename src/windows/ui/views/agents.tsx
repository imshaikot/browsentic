import { Check, Circle, CircleArrowDown, CircleDot, WandSparkles } from 'lucide-react';

import { AgentMark } from '@/extension/components/agent-marks';
import { ModelFilter } from '@/extension/components/model-filter';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/extension/components/ui/select';
import { AGENTS, type AgentDescriptor, type RunnerStatus } from '@/lib/agents/catalog';
import { describeList, offered } from '@/lib/agents/model-list';
import { cn } from '@/lib/utils';
import { Card, OfflineHint, Pill, PrimaryButton, QuietButton, SectionTitle, Spinner } from '../components';
import type { Model, State } from '../model';

const CLI_DEFAULT = '__default__';
const LONG_LIST = 20;

export function AgentsView({ model, state }: { model: Model; state: State }) {
  if (state.daemon !== 'on') return <OfflineHint what="Agent readiness checks" model={model} daemonOff={state.daemon === 'off'} />;
  if (!state.agents) {
    return (
      <div className="flex justify-center p-15">
        <Spinner />
      </div>
    );
  }
  const { agents } = state;
  return (
    <div className="space-y-4.5">
      <Card>
        <SectionTitle
          title="Which agent runs the side panel"
          subtitle="Browsentic ships no model and needs no API key. It drives the agent CLI you are already signed in to."
        />
      </Card>
      {agents.runners.map((runner) => (
        <AgentCard
          key={runner.kind}
          runner={runner}
          descriptor={agents.catalog?.find((entry) => entry.kind === runner.kind) ?? AGENTS[runner.kind]}
          active={agents.active === runner.kind}
          working={state.busy.includes(`agent:${runner.kind}`)}
          model={model}
        />
      ))}
    </div>
  );
}

function AgentCard({ runner, descriptor, active, working, model }: { runner: RunnerStatus; descriptor: AgentDescriptor; active: boolean; working: boolean; model: Model }) {
  const problem = runner.problem;
  const npm = descriptor.install.startsWith('npm ');
  return (
    <Card className={cn(active && 'border-brand/50')}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {active ? <CircleDot className="size-4.5 shrink-0 text-brand" /> : <Circle className="size-4.5 shrink-0 text-ink-faint" />}
          <AgentMark kind={runner.kind} className="size-5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-base font-semibold text-ink">{descriptor.label}</span>
              <span className="text-[11.5px] text-ink-faint">{descriptor.vendor}</span>
              {descriptor.beta && <Pill text="beta" tint="faint" />}
            </div>
            <p className={cn('font-mono text-[11.5px]', runner.ready ? 'text-ink-dim' : 'text-amber')}>
              {runner.ready ? (runner.version ?? 'Ready') : 'Unavailable'}
            </p>
          </div>
          {working && <Spinner />}
          {active ? (
            <Pill text="In use" tint="brand" icon={Check} />
          ) : (
            runner.ready && (
              <QuietButton disabled={working} onClick={() => void model.selectAgent(runner.kind)}>
                Use this agent
              </QuietButton>
            )
          )}
        </div>

        {problem ? (
          <div className="space-y-2 pl-[62px]">
            <p className="text-[12.5px] text-ink-dim">{problem.message}</p>
            {problem.fix && <p className="rounded-lg bg-ground-2 px-2.5 py-1.5 font-mono text-[11.5px] break-all text-ink select-text">{problem.fix}</p>}
            <div className="flex gap-2">
              {problem.code === 'AGENT_MISSING' && (
                <PrimaryButton icon={CircleArrowDown} disabled={working} onClick={() => void model.installAgent(descriptor)}>
                  {npm ? `Install ${descriptor.label}` : 'Open the install guide'}
                </PrimaryButton>
              )}
              {problem.grantable && (
                <PrimaryButton icon={WandSparkles} disabled={working} onClick={() => void model.repairAgent(runner.kind)}>
                  Fix it for me
                </PrimaryButton>
              )}
              <QuietButton onClick={() => void model.openUrl(descriptor.docs)}>Docs</QuietButton>
            </div>
          </div>
        ) : (
          <ModelRow runner={runner} active={active} working={working} model={model} />
        )}
      </div>
    </Card>
  );
}

function ModelRow({ runner, active, working, model }: { runner: RunnerStatus; active: boolean; working: boolean; model: Model }) {
  const list = offered(runner);
  const pinned = runner.model && !list.ids.includes(runner.model) ? runner.model : null;
  const choose = (next: string | null) => void model.setModel(next, runner.kind);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[62px]">
      <span className="text-xs text-ink-dim">Model</span>
      <div className="w-[260px]">
        {list.ids.length > LONG_LIST ? (
          <ModelFilter
            value={runner.model ?? null}
            ids={list.ids}
            suggested={AGENTS[runner.kind].models.filter((id) => list.ids.includes(id))}
            pinned={pinned}
            disabled={working}
            onModel={choose}
          />
        ) : (
          <Select value={runner.model ?? CLI_DEFAULT} onValueChange={(value) => choose(value === CLI_DEFAULT ? null : value)} disabled={working}>
            <SelectTrigger className="h-8 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="font-mono text-xs">
              <SelectItem value={CLI_DEFAULT}>The CLI’s own default</SelectItem>
              {pinned && <SelectItem value={pinned}>{pinned} · not listed</SelectItem>}
              {list.ids.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {active && <span className="basis-full font-mono text-[10px] text-ink-faint">{describeList(runner.kind, list)}</span>}
    </div>
  );
}
