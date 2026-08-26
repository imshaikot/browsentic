import { failure, type ActionResult } from '@/lib/actions/protocol';
import { RESERVED_PREFIX } from '@/lib/actions/reserved';
import { SAVE_SITE_MAP_ACTION } from '@/lib/skills/site-map';
import { log } from '../log';
import type { SiteMapSettings } from './config';
import type { MapTarget, Staging } from './site-map-store';
import type { SiteIndex } from './sitemap';

export interface MapRun {
  target: MapTarget;
  staging: Staging;
  index: SiteIndex;
  settings: SiteMapSettings;
  tabId?: number;
  shots: number;
  pagesVisited: Set<string>;
  offSite: string | null;
  submitted: boolean;
}

const READ_ONLY_ACTIONS = new Set([
  'page.getPageInfo',
  'page.extractText',
  'page.navigate',
  'page.screenshot',
  'page.scrollTo',
  'page.waitForElement',
  'page.hoverElement',
  'page.highlightElement',
  'page.findProgress',
  'page.findSearch',
  'page.findCaptcha',
  'page.monitorStatus',
  'page.timerStatus',
  'page.readTheme',
  'page.auditContrast',
]);

const CLICK_ACTION = 'page.clickElement';

export type Gate =
  | { allow: true; saveTo?: { dir: string; filename: string } }
  | { allow: false; result: ActionResult };

const deny = (code: string, message: string): Gate => ({ allow: false, result: failure(code, message) });

export function gateMappingInvoke(run: MapRun, action: string, input: unknown): Gate {
  if (action === SAVE_SITE_MAP_ACTION) return { allow: true };
  if (action.startsWith(RESERVED_PREFIX)) {
    return deny('UNKNOWN_ACTION', `Unknown action "${action}".`);
  }

  const allowed = READ_ONLY_ACTIONS.has(action) || (run.settings.allowClicks && action === CLICK_ACTION);
  if (!allowed) {
    return deny(
      'MAPPING_READ_ONLY',
      `A site-mapping run may only look at pages, not change them — "${action}" is not available. Record what you see and move on.`,
    );
  }

  if (run.offSite && action !== 'page.navigate') {
    return deny(
      'MAPPING_OFF_SITE',
      `The tab is on ${run.offSite}, not ${run.target.host}. Navigate back to an absolute ${run.target.origin} URL before reading anything.`,
    );
  }

  if (action === 'page.navigate') return gateNavigate(run, input);
  if (action === 'page.screenshot') return gateScreenshot(run);
  return { allow: true };
}

function gateNavigate(run: MapRun, input: unknown): Gate {
  const args = (input ?? {}) as { url?: unknown; action?: unknown };

  if (typeof args.action === 'string') {
    if (args.action === 'reload') return { allow: true };
    return deny(
      'MAPPING_OFF_SITE',
      `"${args.action}" would leave the site being mapped — it walks the tab's own history. Navigate to an absolute ${run.target.origin} URL instead.`,
    );
  }

  if (typeof args.url !== 'string' || !args.url.trim()) {
    return deny('INVALID_INPUT', 'Give page_navigate an absolute URL while mapping.');
  }
  let url: URL;
  try {
    url = new URL(args.url);
  } catch {
    return deny(
      'MAPPING_OFF_SITE',
      `While mapping, page_navigate needs an absolute URL like ${run.target.origin}/pricing — not "${args.url}".`,
    );
  }
  if (url.origin !== run.target.origin) {
    return deny('MAPPING_OFF_SITE', `This run may only visit ${run.target.origin}, not ${url.origin}.`);
  }
  if (run.pagesVisited.size >= run.settings.maxPages && !run.pagesVisited.has(url.pathname)) {
    return deny(
      'MAPPING_BUDGET',
      `This run has already visited ${run.settings.maxPages} pages, which is its limit. Write up what you have with browsentic_saveSiteMap.`,
    );
  }
  return { allow: true };
}

function gateScreenshot(run: MapRun): Gate {
  if (run.shots >= run.settings.maxScreenshots) {
    return deny(
      'MAPPING_BUDGET',
      `This run has taken its ${run.settings.maxScreenshots} screenshots. Carry on mapping without them.`,
    );
  }
  const slug = slugFor(run);
  const filename = `${String(run.shots + 1).padStart(2, '0')}-${slug}.png`;
  return { allow: true, saveTo: { dir: run.staging.screenshots, filename } };
}

function slugFor(run: MapRun): string {
  const last = [...run.pagesVisited].pop() ?? '/';
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'home';
}

export function noteMappingResult(run: MapRun, action: string, result: ActionResult): void {
  if (!result.ok) return;
  const data = result.data as Record<string, unknown> | null;

  if (action === 'page.screenshot') run.shots++;

  const landed = landedUrl(action, data);
  if (!landed) return;
  try {
    const url = new URL(landed);
    if (url.origin === run.target.origin) {
      if (run.offSite) log(`mapping run back on ${run.target.host}`);
      run.offSite = null;
      run.pagesVisited.add(url.pathname);
    } else if (run.offSite !== url.host) {
      run.offSite = url.host;
      log(`mapping run drifted to ${url.host}; reads are blocked until it returns`);
    }
  } catch {
  }
}

function landedUrl(action: string, data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (action === 'page.getPageInfo') {
    const document = data.document as { url?: unknown } | undefined;
    return typeof document?.url === 'string' ? document.url : null;
  }
  if (action === 'page.navigate') {
    return typeof data.navigatedTo === 'string' ? data.navigatedTo : null;
  }
  return null;
}
