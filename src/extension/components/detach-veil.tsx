import { Mic } from 'lucide-react';

/** The mic the panel folds into on its way out — the same orb the page raises a moment later. */
export function DetachVeil() {
  return (
    <div data-detach-veil className="pointer-events-none absolute inset-0 z-50 flex items-end justify-center pb-6">
      <span className="detach-orb glow-brand flex size-14 items-center justify-center rounded-full border border-magenta/50 bg-ground-2 text-magenta">
        <Mic className="size-5" />
      </span>
    </div>
  );
}
