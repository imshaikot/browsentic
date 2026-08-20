import { useState } from 'react';
import { Check, FolderOpen, Images, Trash2, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SiteMapDraft } from '@/lib/skills/site-map';

export function SiteMapReview({
  draft,
  onActivate,
  onDiscard,
}: {
  draft: SiteMapDraft;
  onActivate: (exactHost?: boolean) => void;
  onDiscard: () => void;
}) {
  const [exactHost, setExactHost] = useState(false);
  const matching = exactHost ? draft.host : draft.domain;

  return (
    <div className="enters mb-2 overflow-hidden rounded-xl border border-amber/40 bg-amber/8">
      <div className="flex items-start gap-2 border-b border-amber/25 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">Mapped {draft.host}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-faint">
            <span>{draft.pages} pages</span>
            <span className="inline-flex items-center gap-0.5">
              <Images className="size-2.5" /> {draft.screenshots}
            </span>
            <span>{new Date(draft.generatedAt).toLocaleString()}</span>
          </p>
        </div>
        <Badge variant="warning">not active yet</Badge>
      </div>

      <div className="px-2.5 py-2">
        <p className="mb-2 text-[11px] leading-relaxed text-ink-dim">
          This was written from pages the agent read. Once you activate it, it joins the instructions for every future
          request on <span className="font-mono text-ink">{matching}</span>. Read it first.
        </p>

        {draft.warnings.length > 0 && (
          <div className="mb-2 space-y-1 rounded-lg bg-amber/12 px-2 py-1.5">
            {draft.warnings.map((warning) => (
              <p key={warning} className="flex gap-1.5 text-[11px] leading-snug text-amber">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        )}

        <div className="max-h-56 overflow-x-hidden overflow-y-auto rounded-lg border border-line bg-ground/70">
          <pre className="px-2 py-1.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-ink-dim">
            {draft.markdown}
          </pre>
        </div>

        <p className="mt-1.5 flex items-start gap-1 font-mono text-[10px] break-all text-ink-faint">
          <FolderOpen className="mt-0.5 size-2.5 shrink-0" />
          {draft.directory}
        </p>
        {draft.screenshots > 0 && (
          <p className="mt-0.5 text-[10px] text-ink-faint">
            Screenshots may show pages you were signed in to. They stay on this machine.
          </p>
        )}

        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-dim">
          <input
            type="checkbox"
            checked={exactHost}
            onChange={(event) => setExactHost(event.target.checked)}
            className="size-3 accent-brand"
          />
          Only on <span className="font-mono text-ink">{draft.host}</span>, not its subdomains
        </label>

        <div className="mt-2.5 flex gap-1.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={onDiscard}>
            <Trash2 className="size-3" /> Discard
          </Button>
          <Button size="sm" className="flex-1" onClick={() => onActivate(exactHost)}>
            <Check className="size-3" /> Activate
          </Button>
        </div>
      </div>
    </div>
  );
}
