import { AGENTS, type AgentKind, type ModelList, type RunnerStatus } from '@/lib/agents/catalog';
import { formatWhen } from '@/lib/format-when';

/** The daemon's list when it sent a usable one, the catalog's otherwise. */
export function offered({ kind, models }: RunnerStatus): ModelList {
  return models && Array.isArray(models.ids) && models.ids.length ? models : { ids: AGENTS[kind].models, from: 'catalog' };
}

export function describeList(kind: AgentKind, { ids, from, at, error }: ModelList): string {
  const source = from === 'cli' && at !== undefined ? `${ids.length} listed by ${AGENTS[kind].bin} · ${formatWhen(at)}` : 'built-in list';
  if (!error) return source;
  return from === 'cli' ? `${source} · last read failed` : `${source} · ${error}`;
}
