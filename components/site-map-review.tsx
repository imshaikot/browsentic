import { useState } from 'react';
import { AlertTriangle, Check, FolderOpen, Images, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SiteMapDraft } from '@/lib/skills/site-map';

/**
 * The review step for a freshly mapped site.
 *
 * This is the only place a person sees what a mapping run actually wrote. Everything in the map
 * was derived from pages the agent read, and once armed it joins the system prompt of every
 * future run on that host — so the whole point of this sheet is that nothing is summarised away.
 *
 * The markdown is rendered **literally**, in a monospaced block. Rendering it would let a
 * heading, a link or a zero-width run hide text that the model will still read.
 */
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
    <div className="mb-2 overflow-hidden rounded-md border border-amber-500/40 bg-amber-500/5">
      <div className="flex items-start gap-2 border-b border-amber-500/30 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Mapped {draft.host}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>{draft.pages} pages</span>
            <span className="inline-flex items-center gap-0.5">
              <Images className="size-2.5" /> {draft.screenshots}
            </span>
            <span>{new Date(draft.generatedAt).toLocaleString()}</span>
          </p>
        </div>
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
          not active yet
        </Badge>
      </div>

      <div className="px-2.5 py-2">
        <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
          This was written from pages the agent read. Once you activate it, it joins the instructions for every future
          request on <span className="font-mono">{matching}</span>. Read it first.
        </p>

        {draft.warnings.length > 0 && (
          <div className="mb-1.5 rounded bg-amber-500/15 px-2 py-1.5">
            {draft.warnings.map((warning) => (
              <p key={warning} className="flex gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        )}

        {/*
          Literal, never rendered — a rendered heading or link can hide what the model reads.
          A plain scroller, not ScrollArea: Radix wraps the viewport contents in a `display: table`
          element sized `h-full`, which against a `max-h-*` parent with no definite height resolves
          to auto — so it clips neither axis and the document spills over the buttons below.
        */}
        <div className="max-h-56 overflow-x-hidden overflow-y-auto rounded border bg-background/60">
          <pre className="px-2 py-1.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap">
            {draft.markdown}
          </pre>
        </div>

        <p className="mt-1.5 flex items-start gap-1 text-[10px] break-all text-muted-foreground">
          <FolderOpen className="mt-0.5 size-2.5 shrink-0" />
          {draft.directory}
        </p>
        {draft.screenshots > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Screenshots may show pages you were signed in to. They stay on this machine.
          </p>
        )}

        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={exactHost}
            onChange={(event) => setExactHost(event.target.checked)}
            className="size-3"
          />
          Only on <span className="font-mono">{draft.host}</span>, not its subdomains
        </label>

        <div className="mt-2 flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={onDiscard}>
            <Trash2 className="size-3" /> Discard
          </Button>
          <Button size="sm" className="h-7 flex-1 text-xs" onClick={() => onActivate(exactHost)}>
            <Check className="size-3" /> Activate
          </Button>
        </div>
      </div>
    </div>
  );
}
