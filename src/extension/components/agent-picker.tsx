import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { browser } from 'wxt/browser';

import { StatusDot } from '@/extension/components/status-pill';
import { Button } from '@/extension/components/ui/button';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import { AGENTS, AGENT_LIST, type AgentKind, type AgentState, type RunnerStatus } from '@/lib/agents/catalog';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { cn } from '@/lib/utils';

type Request =
  | { op: 'agentState'; refresh?: boolean }
  | { op: 'setAgent'; agent: AgentKind }
  | { op: 'grantAgent'; agent: AgentKind };

export function AgentPicker() {
  const daemon = useDaemonState();
  const state = daemon?.agent;
  const connected = daemon?.connected ?? false;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connected && !state) void ask({ op: 'agentState' });
    // The daemon pushes its agent state on connect; this only covers a panel opened later.
  }, [connected, state]);

  async function ask(request: Request): Promise<void> {
    setBusy(request.op === 'agentState' ? 'refresh' : request.agent);
    setError(null);
    const result = (await browser.runtime
      .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
      .catch(() => null)) as ActionResult<AgentState> | null;
    setBusy(null);
    if (!result?.ok) setError(result?.error.message ?? 'The daemon did not answer.');
  }

  if (!daemon?.paired) return null;

  const runners = AGENT_LIST.map(
    (agent) => state?.runners.find((runner) => runner.kind === agent.kind) ?? unknownRunner(agent.kind),
  );
  const active = state?.active;
  const problem = runners.find((runner) => runner.kind === active)?.problem;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Agent</h2>
        <button
          type="button"
          onClick={() => void ask({ op: 'agentState', refresh: true })}
          disabled={!connected || busy !== null}
          className="flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase transition-colors hover:text-brand disabled:opacity-40"
        >
          <RefreshCw className={cn('size-3', busy === 'refresh' && 'animate-spin')} /> Recheck
        </button>
      </div>

      <div className="grid gap-1">
        {runners.map((runner) => (
          <AgentRow
            key={runner.kind}
            runner={runner}
            active={runner.kind === active}
            busy={busy === runner.kind}
            disabled={!connected || busy !== null}
            onSelect={() => void ask({ op: 'setAgent', agent: runner.kind })}
          />
        ))}
      </div>

      {problem && active && (
        <div className="space-y-1.5 rounded-lg border border-amber/40 bg-amber/10 p-2">
          <p className="flex gap-1.5 text-[11px] leading-snug text-amber">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>{problem.message}</span>
          </p>
          {problem.fix && (
            <p className="font-mono text-[10px] leading-snug break-all text-ink-faint">{problem.fix}</p>
          )}
          {problem.grantable && (
            <Button
              size="sm"
              className="w-full"
              disabled={!connected || busy !== null}
              onClick={() => void ask({ op: 'grantAgent', agent: active })}
            >
              {busy === active ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Let Browsentic fix it
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </section>
  );
}

function AgentRow({
  runner,
  active,
  busy,
  disabled,
  onSelect,
}: {
  runner: RunnerStatus;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const agent = AGENTS[runner.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || active}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-brand/45 bg-brand/10 text-brand'
          : 'border-line text-ink-dim enabled:hover:border-line-strong enabled:hover:bg-surface/60 enabled:hover:text-ink',
        disabled && !active && 'opacity-50',
      )}
    >
      <StatusDot tone={runner.ready ? 'live' : 'warn'} />
      <span className="min-w-0 flex-1 truncate text-xs">{agent.label}</span>
      <span className="font-mono text-[10px] tracking-wider uppercase opacity-70">{describe(runner)}</span>
      {busy ? <Loader2 className="size-3 animate-spin" /> : active && <Check className="size-3" />}
    </button>
  );
}

function describe(runner: RunnerStatus): string {
  if (runner.ready) return 'ready';
  switch (runner.problem?.code) {
    case 'AGENT_MISSING':
      return 'not installed';
    case 'AGENT_NEEDS_PERMISSION':
      return 'needs setup';
    case 'AGENT_UNUSABLE':
      return 'broken';
    default:
      return 'checking…';
  }
}

const unknownRunner = (kind: AgentKind): RunnerStatus => ({ kind, bin: AGENTS[kind].bin, ready: false });
