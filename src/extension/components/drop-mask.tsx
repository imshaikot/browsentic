import { FileUp, Unplug } from 'lucide-react';

import { cn } from '@/lib/utils';

export function DropMask({ connected, maxBytes }: { connected: boolean; maxBytes: number }) {
  return (
    <div className="enters pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-ground/85 p-4 backdrop-blur-[2px]">
      <div
        className={cn(
          'flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center',
          connected ? 'border-brand/55 bg-brand/8' : 'border-line-strong bg-surface/40',
        )}
      >
        {connected ? (
          <FileUp className="neon-text size-7 text-brand" />
        ) : (
          <Unplug className="size-7 text-ink-faint" />
        )}
        <p className="text-sm font-medium text-ink">{connected ? 'Drop to attach' : 'Not connected'}</p>
        <p className="text-[11px] leading-relaxed text-ink-dim">
          {connected
            ? `Release anywhere in the panel and I’ll read it with your next message — up to ${maxBytes / 1024 / 1024} MB each.`
            : 'Pair the browser before attaching a file.'}
        </p>
      </div>
    </div>
  );
}
