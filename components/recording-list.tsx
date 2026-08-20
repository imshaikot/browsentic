import { useState } from 'react';
import { Check, Clapperboard, Globe, KeyRound, Loader2, Pencil, Play, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { renameRecording, type StoredRecordingMeta } from '@/lib/bridge/recording-store';

export function RecordingList({
  recordings,
  busy,
  onReplay,
  onRemove,
}: {
  recordings: StoredRecordingMeta[];
  busy?: boolean;
  onReplay: (recording: StoredRecordingMeta) => void;
  onRemove: (recordingId: string) => void;
}) {
  if (recordings.length === 0) {
    return (
      <div className="dot-grid fade-bottom rounded-xl border border-line px-3 py-6 text-center">
        <Clapperboard className="mx-auto size-5 text-ink-faint" />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          No recordings yet. Press Record above and walk through the flow you want repeated.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {busy && (
        <p className="px-1 pb-1 text-[11px] text-ink-faint">
          Waiting on the current run — stop it to replay a recording.
        </p>
      )}
      {recordings.map((recording) => (
        <RecordingRow
          key={recording.id}
          recording={recording}
          busy={busy === true}
          onReplay={onReplay}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function RecordingRow({
  recording,
  busy,
  onReplay,
  onRemove,
}: {
  recording: StoredRecordingMeta;
  busy: boolean;
  onReplay: (recording: StoredRecordingMeta) => void;
  onRemove: (recordingId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const ready = recording.status === 'ready';

  return (
    <div className="flex items-start gap-2 rounded-xl border border-line bg-ground/40 px-2.5 py-2 text-xs">
      <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        {editing === null ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-ink">{recording.name}</span>
            {recording.capturedValues && (
              <Badge variant="warning">
                <KeyRound /> values
              </Badge>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input
              value={editing}
              autoFocus
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(null);
                if (e.key === 'Enter') {
                  void renameRecording(recording.id, editing);
                  setEditing(null);
                }
              }}
              aria-label="Recording name"
              className="h-7 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                void renameRecording(recording.id, editing);
                setEditing(null);
              }}
              aria-label="Save name"
              className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <Check className="size-3" />
            </button>
          </div>
        )}

        <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ink-faint">
          <Globe className="size-2.5 shrink-0" />
          <span className="truncate">{recording.host}</span>
        </span>

        {recording.goal && recording.goal !== recording.name && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-dim">{recording.goal}</p>
        )}

        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
          {recording.status === 'analyzing' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Splitting into steps…
            </>
          ) : recording.status === 'error' ? (
            <span className="text-destructive">{recording.error ?? 'Could not read this recording'}</span>
          ) : (
            <>
              {recording.steps ?? 0} {recording.steps === 1 ? 'step' : 'steps'} · {duration(recording.durationMs)} ·{' '}
              {formatWhen(recording.updatedAt)}
            </>
          )}
        </span>

        {ready && (
          <button
            type="button"
            onClick={() => onReplay(recording)}
            disabled={busy}
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-[11px] text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
          >
            <Play className="size-3" /> Do this again
          </button>
        )}
      </div>

      <div className="mt-0.5 flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => setEditing(recording.name)}
          aria-label={`Rename ${recording.name}`}
          className="rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(recording.id)}
          aria-label={`Delete ${recording.name}`}
          className="rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function formatWhen(at: number): string {
  const ago = Date.now() - at;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
