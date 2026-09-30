import { browser, type Browser } from 'wxt/browser';
import { MAX_SLUG, ROOT_SEGMENT } from '@/lib/skills/saved-tool';
import { listSavedTools, onSavedToolsChange, type SavedTool } from './saved-tools';

const SCRIPT_PREFIX = 'browsentic-tool-';

const SYNC_ALARM = 'browsentic/autoRun';

export const QUIET_MS = 400;

export const SETTLE_CAP_MS = 3_000;

type UserScript = Browser.userScripts.RegisteredUserScript;

type AutoRunTool = Pick<SavedTool, 'name' | 'origin' | 'scope' | 'fn' | 'code'>;

/** Chrome throws on any `userScripts` call until Allow User Scripts is switched on. */
export function autoRunReady(): boolean {
  if (import.meta.env.FIREFOX) return false;
  try {
    browser.userScripts.getScripts().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function openUserScriptSettings(): void {
  void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
}

/** Chrome raises no event when Allow User Scripts is switched on, so the alarm picks it up. */
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

  const missing = [...wanted.values()].filter((script) => !current.has(script.id));

  if (stale.length) await browser.userScripts.unregister({ ids: stale });
  await Promise.all(missing.map((script) => browser.userScripts.register([script]).catch(() => undefined)));
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

/** The whole host, so a single-page arrival is caught too; the page itself checks origin and segment. */
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
