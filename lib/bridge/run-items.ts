import { screenshot } from '@/lib/actions/page/screenshot';
import type { RunEvent } from '@/lib/actions/protocol';
import type { MonitorState } from '@/lib/monitor/events';
import { redactInput } from './redact';
import type { ScreenshotPreview } from './screenshot-preview';

export type RunItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string }
  | {
      kind: 'tool';
      id: string;
      action: string;
      input: unknown;
      summary?: string;
      ok?: boolean;
      awaiting?: boolean;
      site?: string;
      source?: 'local' | 'external';
      preview?: ScreenshotPreview;
    };

export const nextId = () => crypto.randomUUID();

export function reduce(items: RunItem[], event: RunEvent): RunItem[] {
  switch (event.kind) {
    case 'started': {
      const overlays = event.overlays?.length ? ` + site notes: ${event.overlays.join(', ')}` : '';
      return [
        ...items,
        { kind: 'notice', id: nextId(), tone: 'info', text: `Loaded skill: ${event.skill}${overlays}` },
      ];
    }

    case 'text': {
      const last = items.at(-1);
      if (last?.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + event.delta }];
      }
      return [...items, { kind: 'assistant', id: nextId(), text: event.delta }];
    }

    case 'tool':
      return [
        ...items,
        {
          kind: 'tool',
          id: event.toolId,
          action: event.action,
          input: redactInput(event.action, event.input),
          source: event.source,
        },
      ];

    case 'approval':
      return patchTool(items, event.toolId, { awaiting: true, site: event.site });

    case 'toolResult':
      return patchTool(items, event.toolId, { ok: event.ok, summary: event.summary, awaiting: false });

    case 'session':
      return items;

    case 'done':
      return event.stopReason === 'end_turn'
        ? items
        : [...items, { kind: 'notice', id: nextId(), tone: 'info', text: `Stopped: ${event.stopReason}` }];

    case 'error':
      return [...items, { kind: 'notice', id: nextId(), tone: 'error', text: `${event.code}: ${event.message}` }];
  }
}

export function patchTool(
  items: RunItem[],
  toolId: string,
  patch: Partial<Extract<RunItem, { kind: 'tool' }>>,
): RunItem[] {
  return items.map((item) => (item.kind === 'tool' && item.id === toolId ? { ...item, ...patch } : item));
}

export function attachPreview(items: RunItem[], preview: ScreenshotPreview): RunItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'tool' && item.action === screenshot.name && !item.preview) {
      const next = [...items];
      next[i] = { ...item, preview };
      return next;
    }
  }
  return items;
}

export function notice(tone: 'info' | 'error', text: string): RunItem {
  return { kind: 'notice', id: nextId(), tone, text };
}

export function monitorNotice(state: MonitorState): { tone: 'info' | 'error'; text: string } {
  const name = state.label ?? state.host;
  const elapsed = clock(state.elapsedMs);
  switch (state.phase) {
    case 'done':
      return { tone: 'info', text: `Monitor “${name}” finished after ${elapsed}.` };
    case 'stopped':
      return { tone: 'info', text: `Monitor “${name}” stopped.` };
    case 'timeout':
      return { tone: 'error', text: `Monitor “${name}” gave up after ${elapsed} without completing.` };
    case 'tab-closed':
      return { tone: 'error', text: `Monitor “${name}” ended — the tab was closed.` };
    default:
      return { tone: 'error', text: `Monitor “${name}” ended — ${state.message ?? 'the tab left the watched site.'}` };
  }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
