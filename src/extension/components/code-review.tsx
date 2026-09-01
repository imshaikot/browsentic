import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ShieldAlert, X } from 'lucide-react';

import { Button } from '@/extension/components/ui/button';

export function CodeReview({
  purpose,
  code,
  site,
  onAllow,
  onDeny,
  onClose,
}: {
  purpose: string;
  code: string;
  site?: string;
  onAllow: () => void;
  onDeny: () => void;
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
      <div className="flex items-start gap-2 border-b border-ember/30 bg-ember/8 px-3 py-2.5">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ember" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Code the agent wrote</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{purpose}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close without deciding"
          className="mt-0.5 shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-ground/70">
        <pre className="min-w-full p-3 font-mono text-[11px] leading-relaxed whitespace-pre text-ink-dim">
          <code>{code}</code>
        </pre>
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
          This runs in {site ? <span className="font-mono text-ink">{site}</span> : 'the page'} with your logged-in
          session, and can do anything you could do there. Later calls reuse these functions without asking again.
        </p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={onDeny}>
            <X className="size-3" /> Deny
          </Button>
          <Button size="sm" className="flex-1" onClick={onAllow}>
            <Check className="size-3" /> Allow
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
