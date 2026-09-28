/**
 * Saved tools that run by themselves on every visit.
 *
 * Chrome's `userScripts` API is the mechanism, not the debugger the `/` path uses: a user
 * script is injected by the browser on each matching load, needs no debugging bar, works
 * with DevTools open, is exempt from the page's CSP and outlives a restart. It only runs
 * once the user has turned on **Allow User Scripts** for the extension, which is why the
 * flag on the saved tool is the truth and the registration is a mirror of it, brought back
 * into line whenever the list changes, the worker starts, the alarm fires, or the panel asks.
 *
 * The match pattern is the whole host on purpose. Scope is decided in the page by the same
 * rule `/` applies — exact origin, then the first path segment's slug — so it holds for
 * single-page sites too, where arriving at `/watch` is a history entry, not a load.
 */

import { browser, type Browser } from 'wxt/browser';
import { MAX_SLUG, ROOT_SEGMENT } from '@/lib/skills/saved-tool';
import { listSavedTools, onSavedToolsChange, type SavedTool } from './saved-tools';

const SCRIPT_PREFIX = 'browsentic-tool-';

const SYNC_ALARM = 'browsentic/autoRun';

/** How long the page must go without a DOM change before the tool runs. */
export const QUIET_MS = 400;

/** The longest a tool waits for quiet, since some pages never stop changing. */
export const SETTLE_CAP_MS = 3_000;

type UserScript = Browser.userScripts.RegisteredUserScript;

type AutoRunTool = Pick<SavedTool, 'name' | 'origin' | 'scope' | 'fn' | 'code'>;

/** Whether Chrome will accept a registration right now: false on Firefox and until Allow User Scripts is on. */
export function autoRunReady(): boolean {
  if (import.meta.env.FIREFOX) return false;
  try {
    browser.userScripts.getScripts().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** The extension's own details page, where Chrome keeps the Allow User Scripts switch. */
export function openUserScriptSettings(): void {
  void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
}

/**
 * Chrome raises no event when Allow User Scripts is switched on, and the API simply appears
 * in the running worker, so a tool waiting on it is picked up by the panel asking while it
 * shows the wait, or by this alarm once the panel is gone.
 */
export function serveAutoRuns(): void {
  if (import.meta.env.FIREFOX) return;
  onSavedToolsChange(() => void syncAutoRuns());
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncAutoRuns();
  });
  void syncAutoRuns();
}

let syncing: Promise<void> = Promise.resolve();

export function syncAutoRuns(): Promise<void> {
  syncing = syncing.then(reconcile, reconcile);
  return syncing;
}

async function reconcile(): Promise<void> {
  if (import.meta.env.FIREFOX || !autoRunReady()) return;
  const wanted = new Map(
    (await listSavedTools()).filter((tool) => tool.autoRun).map((tool) => [scriptIdOf(tool), scriptFor(tool)]),
  );
  const ours = (await browser.userScripts.getScripts()).filter((script) => script.id.startsWith(SCRIPT_PREFIX));
  const current = new Set(ours.filter((script) => sameScript(script, wanted.get(script.id))).map((script) => script.id));
  const stale = ours.filter((script) => !current.has(script.id)).map((script) => script.id);

  if (stale.length) await browser.userScripts.unregister({ ids: stale });
  for (const [id, script] of wanted) {
    if (!current.has(id)) await browser.userScripts.register([script]).catch(() => undefined);
  }
}

function scriptIdOf(tool: SavedTool): string {
  return `${SCRIPT_PREFIX}${tool.id}`;
}

function scriptFor(tool: SavedTool): UserScript {
  return {
    id: scriptIdOf(tool),
    matches: [hostPattern(tool.origin)],
    js: [{ code: autoRunSource(tool) }],
    runAt: 'document_idle',
    world: 'MAIN',
  };
}

/** Every path on the tool's host, any port; the page narrows it to the exact origin and segment. */
function hostPattern(origin: string): string {
  const { protocol, hostname } = new URL(origin);
  return `${protocol}//${hostname}/*`;
}

function sameScript(registered: UserScript, wanted: UserScript | undefined): boolean {
  return (
    !!wanted &&
    registered.js?.[0]?.code === wanted.js?.[0]?.code &&
    registered.world === wanted.world &&
    JSON.stringify(registered.matches) === JSON.stringify(wanted.matches)
  );
}

/**
 * What Chrome injects. The approved code is wrapped exactly as the installer wraps it, so
 * it parses the same way it did when the user read it, and it is evaluated once per
 * document. The entry point runs each time the document arrives in scope — on the load,
 * and again after a single-page site navigates away and back — once the page has loaded
 * and its DOM has gone quiet, which is the state the user watched the tool work in.
 */
export function autoRunSource(tool: AutoRunTool): string {
  return `(() => {
  const origin = ${JSON.stringify(tool.origin)};
  const segment = ${JSON.stringify(tool.scope.segment)};
  const entry = ${JSON.stringify(tool.fn)};
  const label = ${JSON.stringify(tool.name)};

  const slug = (text) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, ${MAX_SLUG}).replace(/-+$/, '');
  const inScope = () => {
    if (location.origin !== origin) return false;
    const [first = ''] = location.pathname.split('/').filter(Boolean);
    return (slug(first) || ${JSON.stringify(ROOT_SEGMENT)}) === segment;
  };
  const report = (error) => console.warn('Browsentic: “' + label + '” did not run on this visit.', error);

  let tools = null;
  const run = () => {
    if (!inScope()) return;
    try {
      if (!tools) {
        tools = {};
        (function (tools) {
${tool.code}
        })(tools);
      }
      const fn = tools[entry];
      Promise.resolve().then(() => fn()).catch(report);
    } catch (error) {
      report(error);
    }
  };

  const whenSettled = (then) => {
    let over = false;
    let quiet;
    const finish = () => {
      if (over) return;
      over = true;
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      then();
    };
    const arm = () => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, ${QUIET_MS});
    };
    const observer = new MutationObserver(arm);
    const cap = setTimeout(finish, ${SETTLE_CAP_MS});
    observer.observe(document.documentElement, { childList: true, subtree: true });
    arm();
  };
  const whenLoaded = (then) => {
    if (document.readyState === 'complete') then();
    else window.addEventListener('load', () => then(), { once: true });
  };

  let inside = false;
  const visit = () => {
    const now = inScope();
    if (now && !inside) whenLoaded(() => whenSettled(run));
    inside = now;
  };
  visit();
  window.navigation?.addEventListener('currententrychange', visit);
})();`;
}
