import { ChevronDown } from 'lucide-react';

import { AgentMark } from '@/extension/components/agent-marks';
import { activeRunner, agentLabel, type AgentState } from '@/lib/agents/catalog';
import { cn } from '@/lib/utils';

/** Which agent a message goes to, and on which model; pressing it opens the picker. */
export function AgentChip({
  state,
  expanded,
  onClick,
}: {
  state: AgentState | undefined;
  expanded: boolean;
  onClick: () => void;
}) {
  const runner = activeRunner(state);
  if (!state || !runner) return null;
  const label = agentLabel(state.active);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`Agent: ${label}${runner.model ? `, ${runner.model}` : ''}. Choose another`}
      className={cn(
        'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors',
        expanded ? 'bg-surface text-ink' : 'text-ink-dim hover:bg-surface/70 hover:text-ink',
        !runner.ready && 'text-ember',
      )}
    >
      <AgentMark kind={state.active} className="size-3" />
      <span className="truncate">
        {label}
        {runner.model && <span className="text-ink-faint"> · {runner.model}</span>}
      </span>
      <ChevronDown className={cn('size-3 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-180')} />
    </button>
  );
}
