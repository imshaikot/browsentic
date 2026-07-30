import type { ActionResult, RunEvent } from '@/lib/actions/protocol';
import { routeIntent } from '@/lib/intent';
import { START_RECORDING_ACTION, STOP_RECORDING_ACTION } from '@/lib/recordings/events';
import { invokeForHarness } from './invoke';
import { startActiveTabRecording, stopRecording } from './recorder';

export async function tryFastPath(text: string, emit: (event: RunEvent) => void): Promise<boolean> {
  const routing = routeIntent(text);
  if (routing.decision !== 'act') return false;

  const { action, input, label, ruleId, score } = routing.intent;
  const toolId = `local-${crypto.randomUUID()}`;
  emit({ kind: 'tool', toolId, action, input, source: 'local' });

  const startedAt = Date.now();
  const result = await run(action, input);
  const elapsed = Date.now() - startedAt;
  emit({
    kind: 'toolResult',
    toolId,
    ok: result.ok,
    summary: result.ok ? `${label} · ${elapsed} ms` : `${result.error.code}: ${result.error.message}`,
  });

  if (!result.ok) {
    if (isRecordingAction(action)) return true;
    console.debug(`[voicelink] fast path ${ruleId} (${score}) failed, escalating:`, result.error.code);
    return false;
  }
  return true;
}

async function run(action: string, input: unknown): Promise<ActionResult> {
  if (action === START_RECORDING_ACTION) {
    const captureValues = (input as { captureValues?: unknown } | undefined)?.captureValues === true;
    return startActiveTabRecording(captureValues);
  }
  if (action === STOP_RECORDING_ACTION) return stopRecording('user');
  return invokeForHarness(action, input);
}

function isRecordingAction(action: string): boolean {
  return action === START_RECORDING_ACTION || action === STOP_RECORDING_ACTION;
}
