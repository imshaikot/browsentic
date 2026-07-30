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

export async function invokeForHarness(action: string, input?: unknown, tabId?: number): Promise<ActionResult> {
  if (action === listFiles.name) return listStoredFiles(input);

  const tab = tabId == null ? (await browser.tabs.query({ active: true, currentWindow: true }))[0] : await pinnedTab(tabId);
  if (tab?.id == null) {
    return tabId == null
      ? failure('NO_ACTIVE_TAB', 'No active tab to control')
      : failure('MAPPING_TAB_CHANGED', 'The tab this run started in has been closed.');
  }
  if (action === navigate.name) return navigateTab(tab.id, input);
  if (action === screenshot.name) return screenshotTab({ id: tab.id, windowId: tab.windowId }, input);
  if (action === attachFile.name) return attachStoredFile(tab.id, input);
  return invokeInTab(tab.id, action, input);
}

async function pinnedTab(tabId: number) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function listStoredFiles(input: unknown): Promise<ActionResult> {
  const filter = (input as { nameContains?: unknown } | undefined)?.nameContains;
  const needle = typeof filter === 'string' ? filter.toLowerCase() : null;
  const files = (await listMeta())
    .filter((f) => !needle || f.name.toLowerCase().includes(needle))
    .map(({ id, name, mime, size, status, summary, addedAt }) => ({ id, name, mime, size, status, summary, addedAt }));
  return success({ files });
}

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

const NO_CONTENT_SCRIPT = 'Receiving end does not exist';

async function navigateTab(tabId: number, input: unknown): Promise<ActionResult> {
  const inPage = await invokeInTab(tabId, navigate.name, input);
  if (inPage.ok) {
    return success({ ...(inPage.data as object), loaded: await watchForLoad(tabId).settled });
  }
  if (inPage.error.code !== 'TAB_UNREACHABLE') return inPage;
  if (!inPage.error.message.includes(NO_CONTENT_SCRIPT)) {
    return success({ navigating: true, loaded: await watchForLoad(tabId).settled });
  }
  return navigateViaTabsApi(tabId, input);
}

async function navigateViaTabsApi(tabId: number, input: unknown): Promise<ActionResult> {
  const parsed = navigate.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));

  let plan;
  try {
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
  const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
    if (updatedTabId === tabId && changeInfo.status === 'complete') finish(true);
  };
  const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
  browser.tabs.onUpdated.addListener(listener);
  return { settled, cancel: () => finish(false) };
}
