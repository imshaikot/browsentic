import { browser } from 'wxt/browser';
import type { ScriptPublicPath } from 'wxt/utils/inject-script';
import type { z } from 'zod';
import type { Action } from './core';
import { ACTION_CHANNEL, failure, type ActionResult } from './protocol';

type InputArgs<I extends z.ZodType> = {} extends z.input<I> ? [input?: z.input<I>] : [input: z.input<I>];

const NO_RECEIVER = 'Receiving end does not exist';

const RETRY_AFTER_HEAL = new Set(['page.getPageInfo', 'page.extractText', 'page.waitForElement', 'page.navigate']);

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
      return failure('TAB_UNREACHABLE', `${detail} — the content script was injected but the page still did not answer`);
    }
  }
}

export async function invokeInActiveTab<I extends z.ZodType = z.ZodType, O = unknown>(
  action: Action<I, O> | string,
  ...[input]: InputArgs<I>
): Promise<ActionResult<O>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return failure('NO_ACTIVE_TAB', 'No active tab to control');
  return invokeInTab(tab.id, action, ...([input] as InputArgs<I>));
}

const INJECT_TIMEOUT_MS = 5_000;

export async function injectContentScript(tabId: number): Promise<boolean> {
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
