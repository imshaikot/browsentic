import { useState } from 'react';
import { X } from 'lucide-react';

import type { FrequentSite } from '@/lib/home/frequent-sites';
import type { FrequentSites as Frequent } from '@/lib/bridge/use-frequent-sites';

export function FrequentSites({ frequent, onHide }: { frequent: Frequent; onHide: (host: string) => void }) {
  if (frequent.needsGrant) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-4 py-4 text-center">
        <p className="text-xs text-ink-faint">The sites you visit most can sit here, one click away.</p>
        <button
          type="button"
          onClick={frequent.grant}
          className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-dim transition-colors hover:border-brand/45 hover:text-ink"
        >
          Show frequent sites
        </button>
      </div>
    );
  }

  if (!frequent.loaded || frequent.sites.length === 0) return null;
  return (
    <nav aria-label="Frequent sites">
      <ul className="flex flex-wrap justify-center gap-1">
        {frequent.sites.map((site) => (
          <li key={site.host} className="group relative w-[5.25rem]">
            <Tile site={site} />
            <button
              type="button"
              onClick={() => onHide(site.host)}
              aria-label={`Hide ${site.host} from frequent sites`}
              title="Hide from frequent sites"
              className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-surface-2 text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Tile({ site }: { site: FrequentSite }) {
  const [broken, setBroken] = useState(false);
  return (
    <a
      href={site.url}
      title={site.url}
      className="flex flex-col items-center gap-2 rounded-2xl px-1 pt-3 pb-2 outline-none transition-colors hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="grid size-12 place-items-center rounded-2xl border border-line bg-ground-2 transition-colors group-hover:border-line-strong">
        {site.icon && !broken ? (
          <img src={site.icon} alt="" className="size-6 rounded-sm" onError={() => setBroken(true)} />
        ) : (
          <span className="font-display text-base font-semibold text-ink-dim uppercase">{site.host.charAt(0)}</span>
        )}
      </span>
      <span className="w-full truncate text-center text-xs text-ink-dim transition-colors group-hover:text-ink">
        {site.label}
      </span>
    </a>
  );
}
