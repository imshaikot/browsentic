import { failure, type ActionResult } from '@/lib/actions/protocol';
import { SAVE_SITE_MAP_ACTION } from '@/lib/skills/site-map';
import { log } from '../log';
import type { SiteMapSettings } from './config';
import type { MapTarget, Staging } from './site-map-store';
import type { SiteIndex } from './sitemap';

/**
 * What a mapping run is allowed to do, enforced in the daemon rather than asked for in prose.
 *
 * A mapping run is unlike every other run in this system: it is autonomous for minutes, it is
 * steered by text it reads on pages, and it runs in the user's real foreground tab with their
 * real sessions. The prose in `site-mapper.md` tells it what to look for; this module is what
 * makes the boundary true whatever it decides to try.
 */

export interface MapRun {
  target: MapTarget;
  staging: Staging;
  index: SiteIndex;
  settings: SiteMapSettings;
  /** The tab the run started in. Every action is pinned to it. */
  tabId?: number;
  shots: number;
  pagesVisited: Set<string>;
  /** The host the tab actually landed on, when it is not the mapped one. */
  offSite: string | null;
  submitted: boolean;
}

/** Read-only by construction: nothing here changes state on a site the user is signed in to. */
const READ_ONLY_ACTIONS = new Set([
  'page.getPageInfo',
  'page.extractText',
  'page.navigate',
  'page.screenshot',
  'page.scrollTo',
  'page.waitForElement',
  'page.hoverElement',
  'page.highlightElement',
]);

/** Added only by `siteMap.allowClicks`. Fill/submit/pressKey/attachFile are never reachable. */
const CLICK_ACTION = 'page.clickElement';

export type Gate =
  | { allow: true; saveTo?: { dir: string; filename: string } }
  | { allow: false; result: ActionResult };

const deny = (code: string, message: string): Gate => ({ allow: false, result: failure(code, message) });

/**
 * The gate every tool call from a mapping run passes, in order. Returns either permission —
 * optionally with the destination the daemon has chosen for a screenshot — or the failure the
 * agent will see.
 */
export function gateMappingInvoke(run: MapRun, action: string, input: unknown): Gate {
  // 1. The one reserved action. Handled by the caller; anything else in that namespace is not
  //    a tool at all and must not reach a tab.
  if (action === SAVE_SITE_MAP_ACTION) return { allow: true };
  if (action.startsWith('voicelink.')) {
    return deny('UNKNOWN_ACTION', `Unknown action "${action}".`);
  }

  // 2. Read-only. This is what makes it acceptable to run unattended on a logged-in browser.
  const allowed = READ_ONLY_ACTIONS.has(action) || (run.settings.allowClicks && action === CLICK_ACTION);
  if (!allowed) {
    return deny(
      'MAPPING_READ_ONLY',
      `A site-mapping run may only look at pages, not change them — "${action}" is not available. Record what you see and move on.`,
    );
  }

  // 3. Once the tab has drifted off the mapped host, nothing may be read from it or captured of
  //    it until a navigate brings it back. Set by `noteMappingResult` from what actually loaded.
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

/**
 * Absolute same-origin URLs only.
 *
 * Relative URLs are refused rather than resolved: the daemon would resolve them against the
 * mapped origin while the action resolves them against the tab's current location, so a page
 * that has redirected itself makes the daemon validate one URL and the browser fetch another.
 *
 * `back`/`forward` are refused for the same reason in reverse — they name no URL at all, and
 * the run starts in the user's real tab with the user's real history behind it.
 */
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
      `This run has already visited ${run.settings.maxPages} pages, which is its limit. Write up what you have with voicelink_saveSiteMap.`,
    );
  }
  return { allow: true };
}

/**
 * The daemon names and places every screenshot. Two consequences worth the code: the agent
 * cannot write outside the staging directory whatever it passes, and the `## Screenshots`
 * section of the generated skill is true by construction rather than by the model's word.
 */
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

/**
 * Fold a result back into the run's state: the page budget, the screenshot count, and the
 * off-site latch.
 *
 * The latch reads the URL that actually loaded, not the one that was asked for. `page.navigate`
 * returns as soon as the tab has been told where to go, and a page may then redirect itself
 * anywhere — so checking only the request would leave a "host-locked" run able to screenshot
 * somebody else's site.
 */
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
    // Not a URL we can judge — leave the latch as it is rather than guessing.
  }
}

/** The URL a result proves the tab is on. Only a snapshot is authoritative about where it landed. */
function landedUrl(action: string, data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (action === 'page.getPageInfo') {
    const document = data.document as { url?: unknown } | undefined;
    return typeof document?.url === 'string' ? document.url : null;
  }
  if (action === 'page.navigate') {
    // `navigatedTo` completed; `navigatingTo` has only been asked for, so it proves nothing —
    // the next getPageInfo is what settles it.
    return typeof data.navigatedTo === 'string' ? data.navigatedTo : null;
  }
  return null;
}
