import type { ReactNode } from 'react';
import { Clapperboard, Cpu, FileText, Globe, Layers, type LucideIcon } from 'lucide-react';

import { AGENTS } from '@/lib/agents/catalog';
import type { ContextBreakdown } from '@/lib/bridge/commands';
import { cn } from '@/lib/utils';

const SEGMENTS = [
  { key: 'user', label: 'you', color: 'bg-brand' },
  { key: 'assistant', label: 'replies', color: 'bg-magenta' },
  { key: 'tools', label: 'tools', color: 'bg-amber' },
  { key: 'notices', label: 'notices', color: 'bg-ink-faint' },
] as const;

export function ContextCard({ breakdown }: { breakdown: ContextBreakdown }) {
  const { messages, files, recordings, filesOmitted, recordingsOmitted } = breakdown;
  const total = SEGMENTS.reduce((sum, segment) => sum + messages[segment.key], 0);
  const empty = total === 0 && files.length === 0 && recordings.length === 0;

  return (
    <div className="enters panel-card min-w-0 rounded-2xl px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 shrink-0 text-brand" />
        <span className="flex-1 truncate font-mono text-[10px] tracking-[0.14em] text-ink uppercase">
          Session context
        </span>
        <span className="shrink-0 rounded-full bg-ground/60 px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] text-ink-faint uppercase">
          {agentLabel(breakdown)}
        </span>
      </div>

      {empty ? (
        <p className="mt-2 text-[11px] text-ink-dim">This conversation is empty — nothing rides along yet.</p>
      ) : (
        <>
          {total > 0 && (
            <>
              <div className="mt-2.5 flex h-1.5 gap-px overflow-hidden rounded-full">
                {SEGMENTS.filter((segment) => messages[segment.key] > 0).map((segment) => (
                  <span key={segment.key} className={segment.color} style={{ flexGrow: messages[segment.key] }} />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {SEGMENTS.map((segment) => (
                  <span key={segment.key} className="flex items-center gap-1 text-[10px] text-ink-dim">
                    <span className={cn('size-1.5 shrink-0 rounded-full', segment.color)} />
                    <span className="font-mono">{messages[segment.key]}</span> {segment.label}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2">
            <Row icon={Globe}>
              {breakdown.tabCount === 1 ? '1 tab' : `${breakdown.tabCount} tabs`}
              {breakdown.host && <> · {breakdown.host}</>} · turn{' '}
              <span className="font-mono text-[10px]">{breakdown.turns}</span> ·{' '}
              <span className="font-mono text-[10px]">{compact(messages.chars)}</span> characters
            </Row>
            <Row icon={Cpu}>
              {breakdown.usage ? (
                <>
                  Agent window ≈ <span className="font-mono text-[10px]">{compact(breakdown.usage.contextTokens)}</span>{' '}
                  tokens · <span className="font-mono text-[10px]">{compact(breakdown.usage.outputTokens)}</span>{' '}
                  generated last run
                </>
              ) : breakdown.agent === 'antigravity' ? (
                'Antigravity does not report token counts.'
              ) : (
                'Token counts appear after the agent’s first reply.'
              )}
            </Row>
            {files.map((file, index) => (
              <Row key={index} icon={FileText}>
                <span className="text-ink">{file.name}</span>
                <span className="font-mono text-[10px] text-ink-faint"> · {formatBytes(file.size)}</span>
                {file.status === 'pending' && <span className="text-ink-faint"> · analyzing</span>}
                {file.status === 'error' && <span className="text-destructive"> · analysis failed</span>}
              </Row>
            ))}
            {filesOmitted > 0 && (
              <p className="pl-[18px] text-[10px] text-ink-faint">
                {filesOmitted} more {filesOmitted === 1 ? 'file stays' : 'files stay'} behind — only the first{' '}
                {files.length} ride along.
              </p>
            )}
            {recordings.map((recording, index) => (
              <Row key={index} icon={Clapperboard}>
                <span className="text-ink">{recording.name}</span>
                {recording.steps !== undefined && (
                  <span className="font-mono text-[10px] text-ink-faint"> · {recording.steps} steps</span>
                )}
              </Row>
            ))}
            {recordingsOmitted > 0 && (
              <p className="pl-[18px] text-[10px] text-ink-faint">
                {recordingsOmitted} more {recordingsOmitted === 1 ? 'recording stays' : 'recordings stay'} behind —
                only the first {recordings.length} ride along.
              </p>
            )}
          </div>
        </>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
        Held in this browser — files and ready recordings ride along with your next message.
      </p>
    </div>
  );
}

function Row({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-[11px] text-ink-dim">
      <Icon className="mt-0.5 size-3 shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

function agentLabel(breakdown: ContextBreakdown): string {
  if (!breakdown.agent) return 'no agent yet';
  return `${AGENTS[breakdown.agent].label}${breakdown.resumes ? ' · resumes' : ''}`;
}

function compact(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} k`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
