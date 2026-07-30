import type { RunEvent } from '@/lib/actions/protocol';
import { routeIntent } from '@/lib/intent';
import { invokeForHarness } from './invoke';

export async function tryFastPath(text: string, emit: (event: RunEvent) => void): Promise<boolean> {
  const routing = routeIntent(text);
  if (routing.decision !== 'act') return false;

  const { action, input, label, ruleId, score } = routing.intent;
  const toolId = `local-${crypto.randomUUID()}`;
  emit({ kind: 'tool', toolId, action, input, source: 'local' });

  const startedAt = Date.now();
  const result = await invokeForHarness(action, input);
  const elapsed = Date.now() - startedAt;
  emit({
    kind: 'toolResult',
    toolId,
    ok: result.ok,
    summary: result.ok ? `${label} · ${elapsed} ms` : `${result.error.code}: ${result.error.message}`,
  });

  if (!result.ok) {
    console.debug(`[voicelink] fast path ${ruleId} (${score}) failed, escalating:`, result.error.code);
    return false;
  }
  return true;
}
