import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { attachFile } from '@/lib/actions/page/attach-file';
import { listFiles } from '@/lib/actions/page/list-files';
import { navigate, resolveNavigation, type NavigateInput } from '@/lib/actions/page/navigate';
import { screenshot } from '@/lib/actions/page/screenshot';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { listMeta, readBytes } from '@/lib/bridge/file-store';
import { screenshotTab } from '@/lib/bridge/screenshot';

const LOAD_TIMEOUT_MS = 10_000;

/**
 * Run an action in the active tab on behalf of an outside caller (the MCP daemon or the
 * side panel). Same path as `invokeInActiveTab`, except for navigation — see below.
 */
export async function invokeForHarness(action: string, input?: unknown): Promise<ActionResult> {
  // The file repository lives in extension storage, which a content script cannot read, so both
  // file actions resolve here. listFiles needs no tab at all — it only reads storage.
  if (action === listFiles.name) return listStoredFiles(input);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return failure('NO_ACTIVE_TAB', 'No active tab to control');
  // Navigation and screenshots are special-cased: both need background-only APIs (the tabs API,
  // captureVisibleTab) that a content script cannot reach, so they run here rather than in-page.
  if (action === navigate.name) return navigateTab(tab.id, input);
  if (action === screenshot.name) return screenshotTab({ id: tab.id, windowId: tab.windowId }, input);
  // attachFile reads the stored bytes here (a page cannot), then runs the DOM write in-page.
  if (action === attachFile.name) return attachStoredFile(tab.id, input);
  return invokeInTab(tab.id, action, input);
}

/** page.listFiles: read the file index from extension storage; hand back metadata, never bytes. */
async function listStoredFiles(input: unknown): Promise<ActionResult> {
  const filter = (input as { nameContains?: unknown } | undefined)?.nameContains;
  const needle = typeof filter === 'string' ? filter.toLowerCase() : null;
  const files = (await listMeta())
    .filter((f) => !needle || f.name.toLowerCase().includes(needle))
    .map(({ id, name, mime, size, status, summary, addedAt }) => ({ id, name, mime, size, status, summary, addedAt }));
  return success({ files });
}

/** page.attachFile: fetch the stored bytes here, then hand them to the in-page DOM action. */
async function attachStoredFile(tabId: number, input: unknown): Promise<ActionResult> {
  const { fileId, target } = (input ?? {}) as { fileId?: unknown; target?: unknown };
  if (typeof fileId !== 'string' || !fileId) {
    return failure('INVALID_INPUT', 'attachFile needs a "fileId" from page.listFiles.');
  }
  const bytes = await readBytes(fileId);
  if (!bytes) {
    return failure('FILE_NOT_FOUND', `No stored file with id "${fileId}". Call page.listFiles to see stored files.`);
  }
  return invokeInTab(tabId, attachFile.name, {
    fileId,
    target,
    name: bytes.name,
    mime: bytes.mime,
    content: bytes.content,
  });
}

/** Chrome's wording for "no listener was there", i.e. the message never reached a page. */
const NO_CONTENT_SCRIPT = 'Receiving end does not exist';

/**
 * Navigate the active tab, preferring the in-page action and falling back to the tabs API.
 *
 * In-page navigation is authoritative and pushes a history entry, so `back` works
 * afterwards — but it cannot run where no content script does, and `tabs.update` works
 * everywhere but *replaces* the current history entry. `invokeInTab` already injects the
 * content script into tabs that merely lack it (opened before the extension loaded), so by
 * the time "Receiving end does not exist" surfaces here the page genuinely refuses content
 * scripts (a new tab, a chrome:// page) and the tabs API is the only route.
 *
 * Falling back is only safe when the action provably never ran. Chrome distinguishes the
 * two failures: "Receiving end does not exist" is a pre-delivery error (no content script,
 * nothing happened), while "message port closed" means the page received it and then
 * unloaded — already navigating, so re-issuing would navigate twice.
 */
async function navigateTab(tabId: number, input: unknown): Promise<ActionResult> {
  const inPage = await invokeInTab(tabId, navigate.name, input);
  if (inPage.ok) {
    return success({ ...(inPage.data as object), loaded: await watchForLoad(tabId).settled });
  }
  if (inPage.error.code !== 'TAB_UNREACHABLE') return inPage;
  if (!inPage.error.message.includes(NO_CONTENT_SCRIPT)) {
    // Delivered, then the page unloaded: the navigation is already under way.
    return success({ navigating: true, loaded: await watchForLoad(tabId).settled });
  }
  return navigateViaTabsApi(tabId, input);
}

async function navigateViaTabsApi(tabId: number, input: unknown): Promise<ActionResult> {
  // Same validation and wording as `dispatch`, which the in-page path would have used.
  const parsed = navigate.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  let plan;
  try {
    // No base URL: relative navigation stays unsupported by choice, so the daemon never has
    // to read the tab's URL to resolve one (host_permissions would now allow that read).
    plan = resolveNavigation(parsed.data as NavigateInput);
  } catch (error) {
    return error instanceof ActionError
      ? failure(error.code, error.message)
      : failure('ACTION_FAILED', String(error));
  }

  const loaded = watchForLoad(tabId);
  try {
    if (plan.kind === 'url') await browser.tabs.update(tabId, { url: plan.href });
    else if (plan.action === 'reload') await browser.tabs.reload(tabId);
    else if (plan.action === 'back') await browser.tabs.goBack(tabId);
    else await browser.tabs.goForward(tabId);
  } catch (error) {
    loaded.cancel();
    const detail = error instanceof Error ? error.message : String(error);
    // goBack/goForward reject when there is nowhere to go, and Chrome's wording does not
    // say which direction failed — name it so the caller can tell what to try instead.
    return failure(
      'ACTION_FAILED',
      plan.kind === 'history' && plan.action !== 'reload'
        ? `Cannot go ${plan.action}: this tab has no ${plan.action === 'back' ? 'previous' : 'next'} page in its history (${detail})`
        : detail,
    );
  }

  const completed = await loaded.settled;
  return success(
    plan.kind === 'url'
      ? { navigatedTo: plan.href, loaded: completed }
      : { performed: plan.action, loaded: completed },
  );
}

function watchForLoad(tabId: number) {
  let settle!: (loaded: boolean) => void;
  const settled = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const finish = (loaded: boolean) => {
    browser.tabs.onUpdated.removeListener(listener);
    clearTimeout(timer);
    settle(loaded);
  };
  // Only `status` is needed to know the load finished; we deliberately ignore `changeInfo.url`
  // (now readable under host_permissions) so this stays a pure load-completion watcher.
  const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') finish(true);
  };
  const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
  browser.tabs.onUpdated.addListener(listener);
  return { settled, cancel: () => finish(false) };
}
