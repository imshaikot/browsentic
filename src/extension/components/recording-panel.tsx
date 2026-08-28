import { useState } from 'react';
import { Circle, Square } from 'lucide-react';
import { Button } from '@/extension/components/ui/button';
import { RecordingList } from '@/extension/components/recording-list';
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
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Capture what you do on a site — the clicks, the fields you fill, the pages you move through — and the agent can
        repeat it later. A recording runs for at most 15 minutes.
      </p>

      {recording ? (
        <Button variant="destructive" onClick={onStop}>
          <Square className="fill-current" /> Stop recording
        </Button>
      ) : (
        <Button
          variant="destructive"
          onClick={() => onStart(captureValues)}
          disabled={!recordable}
          title={recordable ? `Record what you do on ${host}` : 'Open an http(s) page, with nothing else running'}
        >
          <Circle className="fill-current" />
          <span className="truncate">Record {host || 'this page'}</span>
        </Button>
      )}

      {!recording && (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-ground/40 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
          <input
            type="checkbox"
            checked={captureValues}
            onChange={(e) => setCaptureValues(e.target.checked)}
            className="mt-0.5 size-3 shrink-0 accent-destructive"
          />
          <span>
            <span className="font-medium text-ink">Save what I type.</span> Off by default — every field becomes a
            placeholder the agent asks you to fill. Passwords and card numbers are never saved either way.
          </span>
        </label>
      )}

      <RecordingList recordings={recordings} busy={busy} onReplay={onReplay} onRemove={onRemove} />
    </div>
  );
}
