import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { z } from 'zod';
import type { Action } from './core';
import { ACTION_CHANNEL, failure, type ActionResult } from './protocol';

/** Make the input argument optional only when every field of the action's schema is optional. */
type InputArgs<I extends z.ZodType> = {} extends z.input<I> ? [input?: z.input<I>] : [input: z.input<I>];

/** Chrome's wording for "no listener was there" — the message never reached a page. */
const NO_RECEIVER = 'Receiving end does not exist';

/**
 * Actions that may be re-sent automatically after healing a tab. "No listener" is not only
 * the stranded-tab state — it is also any tab mid-navigation, after the new document commits
 * and before its content script runs. A heal in that window injects into the *new* page, so
 * an automatic retry must be safe against a document the caller never saw: these either only
 * read, or act on the tab rather than page content. Everything that clicks, types, selects
 * or submits is deliberately absent — after a heal the caller has to look again first.
 */
const RETRY_AFTER_HEAL = new Set(['page.getPageInfo', 'page.extractText', 'page.waitForElement', 'page.navigate']);

/** Invoke an action inside a tab's page from any extension context. */
export async function invokeInTab<I extends z.ZodType = z.ZodType, O = unknown>(
  tabId: number,
  action: Action<I, O> | string,
  ...[input]: InputArgs<I>
): Promise<ActionResult<O>> {
  const name = typeof action === 'string' ? action : action.name;
  const send = async () =>
    (await browser.tabs.sendMessage(tabId, { channel: ACTION_CHANNEL, action: name, input })) as ActionResult<O>;

  try {
    return await send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(NO_RECEIVER)) return unreachable(message);
    // Usually a stranded tab — one opened before this extension version loaded, which
    // declared content scripts never reach. Heal it either way; what happens next depends
    // on whether re-running the action against a possibly-changed page can misfire.
    if (!(await injectContentScript(tabId))) return unreachable(message);
    if (!RETRY_AFTER_HEAL.has(name)) {
      return failure(
        'TAB_UNREACHABLE',
        'This tab had no content script; one has just been injected and the tab is reachable now. ' +
          'Take a fresh page.getPageInfo snapshot — the page may have changed — then retry the action.',
      );
    }
    try {
      return await send();
    } catch (retryError) {
      const detail = retryError instanceof Error ? retryError.message : String(retryError);
      // Not unreachable(): injection succeeding proves the page allows content scripts.
      return failure('TAB_UNREACHABLE', `${detail} — the content script was injected but the page still did not answer`);
    }
  }
}

/** Invoke an action in the currently active tab. */
export async function invokeInActiveTab<I extends z.ZodType = z.ZodType, O = unknown>(
  action: Action<I, O> | string,
  ...[input]: InputArgs<I>
): Promise<ActionResult<O>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return failure('NO_ACTIVE_TAB', 'No active tab to control');
  return invokeInTab(tab.id, action, ...([input] as InputArgs<I>));
}

/** A hung document must not park the injection until `document_idle` past the daemon's budget. */
const INJECT_TIMEOUT_MS = 5_000;

/**
 * Put this extension's own content script into a tab that is missing it. The file list comes
 * from the built manifest, so it stays correct however the bundler names things. False means
 * the page genuinely does not allow content scripts (chrome://, the Web Store), or the tab was
 * too slow to inject into — injection is best-effort, and the original failure stands.
 *
 * `injectImmediately` runs the script without waiting for the document to be idle; a still
 * bounded timeout guards the rest, since a mid-navigation tab can reject the call until the
 * new document commits. Without both, a slow page could stall the caller — and every daemon
 * invocation it is nested in — well past the 30s per-action timeout.
 */
export async function injectContentScript(tabId: number): Promise<boolean> {
  // The manifest reports plain paths; executeScript's type wants its branded path strings.
  const files = (browser.runtime.getManifest().content_scripts ?? []).flatMap(
    (script) => script.js ?? [],
  ) as ScriptPublicPath[];
  if (!files.length) return false;
  try {
    await withTimeout(browser.scripting.executeScript({ target: { tabId }, files, injectImmediately: true }));
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('injection timed out')), INJECT_TIMEOUT_MS)),
  ]);
}

const unreachable = (detail: string): ActionResult<never> =>
  failure('TAB_UNREACHABLE', `${detail} — the page may not allow content scripts`);
