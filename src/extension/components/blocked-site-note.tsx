import { Ban } from 'lucide-react';
import { openBlockedSites } from '@/lib/bridge/use-extension-settings';

export const BLOCKED_HERE = 'This site is on your Blocked sites list, so Browsentic won’t read or act on it.';

export function BlockedSiteNote({ pattern }: { pattern: string }) {
  return (
    <div className="enters mb-2 flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/8 px-3 py-2.5">
      <Ban className="mt-0.5 size-3.5 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">Browsentic is blocked on this site</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
          It matches <span className="font-mono text-ink">{pattern}</span>, so nothing here is read or touched. The agent
          can still work in other tabs.
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 text-[11px] font-medium text-brand hover:underline"
        onClick={openBlockedSites}
      >
        Manage
      </button>
    </div>
  );
}
