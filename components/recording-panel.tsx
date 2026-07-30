import { useState } from 'react';
import { Circle, Clapperboard, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecordingList } from '@/components/recording-list';
import type { StoredRecordingMeta } from '@/lib/bridge/recording-store';
import type { RecordingState } from '@/lib/recordings/events';
import { hostnameOf } from '@/lib/skills/format';

export function RecordingPanel({
  tabUrl,
  recordings,
  recording,
  busy,
  onStart,
  onStop,
  onReplay,
  onRemove,
}: {
  tabUrl: string;
  recordings: StoredRecordingMeta[];
  recording: RecordingState | null;
  busy?: boolean;
  onStart: (captureValues: boolean) => void;
  onStop: () => void;
  onReplay: (recording: StoredRecordingMeta) => void;
  onRemove: (recordingId: string) => void;
}) {
  const [captureValues, setCaptureValues] = useState(false);
  const host = hostnameOf(tabUrl);
  const recordable = !busy && !recording && /^https?:/.test(tabUrl);

  return (
    <div className="mb-2 rounded-md border bg-muted/30 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Clapperboard className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium">Recordings</span>
        {recordings.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{recordings.length} saved</span>
        )}
      </div>

      {recording ? (
        <Button
          size="sm"
          className="mb-2 w-full bg-red-600 text-white shadow-xs hover:bg-red-700"
          onClick={onStop}
        >
          <Square className="size-3 fill-current" /> Stop recording
        </Button>
      ) : (
        <Button
          size="sm"
          className="mb-2 w-full bg-red-600 text-white shadow-xs hover:bg-red-700 disabled:bg-muted disabled:text-muted-foreground"
          onClick={() => onStart(captureValues)}
          disabled={!recordable}
          title={recordable ? `Record what you do on ${host}` : 'Open an http(s) page, with nothing else running'}
        >
          <Circle className="size-3 fill-current" />
          <span className="truncate">Record {host || 'this page'}</span>
        </Button>
      )}

      {!recording && (
        <label className="mb-2 flex cursor-pointer items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            checked={captureValues}
            onChange={(e) => setCaptureValues(e.target.checked)}
            className="mt-0.5 size-3 shrink-0 accent-red-500"
          />
          <span>
            Save what I type. Off by default — every field becomes a placeholder the assistant asks you to fill.
            Passwords and card numbers are never saved either way. Recording stops after 15 minutes.
          </span>
        </label>
      )}

      <div className="max-h-56 overflow-y-auto">
        <RecordingList recordings={recordings} busy={busy} onReplay={onReplay} onRemove={onRemove} />
      </div>
    </div>
  );
}
