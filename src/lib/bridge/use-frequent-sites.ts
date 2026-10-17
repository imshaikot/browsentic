import { useCallback, useEffect, useMemo, useState } from 'react';
import { frequentSites, type FrequentSite, type VisitedSite } from '@/lib/home/frequent-sites';
import { askForTopSites, canReadTopSites, readTopSites } from './top-sites';

export interface FrequentSites {
  sites: FrequentSite[];
  /** False until the browser has answered, so the row never jumps in under the composer. */
  loaded: boolean;
  needsGrant: boolean;
  /** Spends the click it is called from on the browser's permission prompt. */
  grant: () => void;
}

export function useFrequentSites(shown: boolean, hidden: readonly string[]): FrequentSites {
  const [visited, setVisited] = useState<VisitedSite[] | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const allowed = await canReadTopSites().catch(() => false);
    setGranted(allowed);
    setVisited(allowed ? await readTopSites().catch(() => []) : []);
  }, []);

  useEffect(() => {
    if (shown) void load();
  }, [shown, load]);

  const grant = useCallback(() => {
    void askForTopSites().then((allowed) => {
      if (allowed) void load();
    });
  }, [load]);

  const sites = useMemo(() => frequentSites(visited ?? [], hidden), [visited, hidden]);
  return { sites, loaded: visited !== null, needsGrant: granted === false, grant };
}
