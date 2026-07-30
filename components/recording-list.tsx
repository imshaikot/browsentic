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
      <p className="px-1 py-1 text-[11px] leading-relaxed text-muted-foreground">
        No recordings yet. Press Record above to capture what you do on a site — the clicks, the fields you fill, the
        pages you move through — and VoiceLink turns it into steps the assistant can repeat later. A recording runs for
        at most 15 minutes.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {busy && (
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
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
    <div className="flex items-start gap-2 rounded-md border bg-background/60 px-2.5 py-1.5 text-xs">
      <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {editing === null ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{recording.name}</span>
            {recording.capturedValues && (
              <Badge variant="outline" className="h-4 shrink-0 gap-0.5 px-1 text-[10px]">
                <KeyRound className="size-2.5" /> values
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
              className="h-6 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                void renameRecording(recording.id, editing);
                setEditing(null);
              }}
              aria-label="Save name"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Check className="size-3" />
            </button>
          </div>
        )}

        <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Globe className="size-2.5 shrink-0" />
          <span className="truncate">{recording.host}</span>
        </span>

        {recording.goal && recording.goal !== recording.name && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{recording.goal}</p>
        )}

        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
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
            className="mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-primary hover:bg-muted disabled:opacity-50"
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
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(recording.id)}
          aria-label={`Delete ${recording.name}`}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
