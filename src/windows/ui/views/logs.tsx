import { useEffect, useRef, useState } from 'react';
import { Folder } from 'lucide-react';

import { Switch } from '@/extension/components/ui/switch';
import { Card, CopyButton, QuietButton, SectionTitle } from '../components';
import { short, type Model, type State } from '../model';

const tone = (message: string) => {
  const lowered = message.toLowerCase();
  if (['rejected', 'error', 'failed'].some((word) => lowered.includes(word))) return 'text-destructive';
  if (['drifted', 'revoked'].some((word) => lowered.includes(word))) return 'text-amber';
  if (['connected', 'paired', 'listening'].some((word) => lowered.includes(word))) return 'text-lime';
  return 'text-ink-dim';
};

/** A log line opens with an ISO stamp; the clock time is all the view needs of it. */
export function splitLine(text: string): { time: string; message: string } {
  const space = text.indexOf(' ');
  const stamp = space < 0 ? '' : text.slice(0, space);
  const message = space < 0 ? text : text.slice(space + 1);
  return { time: stamp.length >= 19 && stamp.includes('T') ? stamp.slice(11, 19) : stamp, message };
}

export function LogsView({ model, state }: { model: Model; state: State }) {
  const [following, setFollowing] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void model.loadLog();
    const tick = setInterval(() => void model.loadLog(), 1500);
    return () => clearInterval(tick);
  }, [model]);

  useEffect(() => {
    if (following) end.current?.scrollIntoView({ block: 'end' });
  }, [state.logText, following]);

  const log = state.info?.paths.log ?? '';
  const lines = state.logText.split(/\r?\n/).filter(Boolean);

  return (
    <Card padded={false}>
      <div className="flex items-center gap-2 p-4">
        <div className="min-w-0 flex-1">
          <SectionTitle title="Daemon log" subtitle={short(log, state.info)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          Follow
          <Switch checked={following} label="Follow the log" onChange={setFollowing} />
        </label>
        <CopyButton value={state.logText} label="Copy all" />
        <QuietButton icon={Folder} onClick={() => void model.reveal(log)}>
          Show
        </QuietButton>
      </div>
      <div className="h-[470px] overflow-y-auto border-t border-line bg-ground-2/60 p-3.5 font-mono text-[11px] select-text">
        {lines.map((line, index) => {
          const { time, message } = splitLine(line);
          return (
            <div key={index} className="flex gap-2.5 leading-[1.45]">
              <span className="shrink-0 text-ink-faint">{time}</span>
              <span className={tone(message)}>{message}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </Card>
  );
}
