import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Trash2, X, Zap } from 'lucide-react';

import { Button } from '@/extension/components/ui/button';
import { Switch } from '@/extension/components/ui/switch';
import { openUserScriptSettings } from '@/lib/bridge/auto-run';
import type { ToolOffer } from '@/lib/bridge/code-toolkit';
import type { SavedToolMeta } from '@/lib/bridge/saved-tools';
import { displayName, slugify } from '@/lib/skills/saved-tool';

/**
 * The offer, a second after an approved toolkit lands. It shows the name it would take
 * rather than asking for one, because the answer is usually yes and the name is usually
 * right — but the last segment stays editable, since that is the part the user will type.
 */
export function KeepToolPrompt({
  offer,
  autoRunReady,
  onKeep,
  onDismiss,
}: {
  offer: ToolOffer;
  autoRunReady: boolean;
  onKeep: (slug: string, autoRun: boolean) => void;
  onDismiss: () => void;
}) {
  const [slug, setSlug] = useState(offer.suggestedSlug);
  const [autoRun, setAutoRun] = useState(false);
  useEffect(() => {
    setSlug(offer.suggestedSlug);
    setAutoRun(false);
  }, [offer.toolkitId, offer.suggestedSlug]);

  const clean = slugify(slug) || offer.suggestedSlug;
  const where = offer.segment === 'root' ? offer.host : `${offer.host}/${offer.segment}`;

  return (
    <div className="enters mb-2 rounded-xl border border-lime/30 bg-lime/8 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Zap className="mt-0.5 size-3.5 shrink-0 text-lime" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Keep this as a tool for {where}?</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{offer.purpose}</p>
        </div>
      </div>

      <label className="mt-2.5 block">
        <span className="sr-only">Tool name</span>
        <span className="flex items-center rounded-lg border border-line bg-ground/60 px-2 py-1 font-mono text-[10px]">
          <span className="shrink-0 text-ink-faint">{offer.host}:{offer.segment}:</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            spellCheck={false}
            aria-label="Tool name"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none"
          />
        </span>
      </label>
      <p className="mt-1 font-mono text-[10px] text-ink-faint">
        runs with /{displayName({ host: offer.host, segment: offer.segment }, clean)}
      </p>

      <label className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-dim">
        <Switch checked={autoRun} onChange={setAutoRun} label={`Also run it on every visit to ${where}`} />
        Also run it on every visit to {where}
      </label>
      {autoRun && !autoRunReady && <AllowUserScripts />}

      <div className="mt-2.5 flex gap-1.5">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onDismiss}>
          <X className="size-3" /> No
        </Button>
        <Button size="sm" className="flex-1" onClick={() => onKeep(clean, autoRun)}>
          <Check className="size-3" /> Yes, keep it
        </Button>
      </div>
    </div>
  );
}

function AllowUserScripts() {
  return (
    <p className="mt-1.5 text-[10px] leading-relaxed text-amber">
      Chrome runs a tool on every visit only once <span className="font-medium">Allow User Scripts</span> is on for
      Browsentic.{' '}
      <button type="button" onClick={openUserScriptSettings} className="underline underline-offset-2 hover:text-ink">
        Open settings
      </button>
    </p>
  );
}

/** `/remove-tools`: everything saved, with a cross on each. */
export function SavedToolList({
  tools,
  autoRunReady,
  onAutoRun,
  onForget,
  onClose,
}: {
  tools: SavedToolMeta[];
  autoRunReady: boolean;
  onAutoRun: (id: string, on: boolean) => void;
  onForget: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="enters fixed inset-0 z-50 flex flex-col bg-ground/96 backdrop-blur">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <Zap className="mt-0.5 size-3.5 shrink-0 text-lime" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Your tools</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
            Removing one deletes its code from the browser and its note from the daemon.
          </p>
          {!autoRunReady && tools.some((tool) => tool.autoRun) && <AllowUserScripts />}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="mt-0.5 shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tools.length === 0 ? (
          <p className="px-3 py-4 text-[11px] leading-relaxed text-ink-faint">
            Nothing saved yet. Turn the Live tool switch on, ask for something the ordinary tools cannot do, and
            you will be offered the result to keep.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tools.map((tool) => (
              <li key={tool.id} className="flex items-start gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-ink">{tool.name}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{tool.description}</p>
                  <label className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-faint">
                    <Switch
                      checked={tool.autoRun === true}
                      onChange={(on) => onAutoRun(tool.id, on)}
                      label={`Run ${tool.name} on every visit`}
                    />
                    Every visit
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => onForget(tool.id)}
                  title={`Remove ${tool.name}`}
                  aria-label={`Remove ${tool.name}`}
                  className="mt-0.5 shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-ember/10 hover:text-ember"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
