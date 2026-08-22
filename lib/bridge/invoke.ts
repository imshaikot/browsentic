import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { attachFile } from '@/lib/actions/page/attach-file';
import { awaitMonitor } from '@/lib/actions/page/await-monitor';
import { closeTab } from '@/lib/actions/page/close-tab';
import { dragElement } from '@/lib/actions/page/drag-element';
import { findCaptcha } from '@/lib/actions/page/find-captcha';
import { listFiles } from '@/lib/actions/page/list-files';
import { listRecordings } from '@/lib/actions/page/list-recordings';
import { monitorStatus } from '@/lib/actions/page/monitor-status';
import { navigate, resolveNavigation, type NavigateInput } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { readRecording } from '@/lib/actions/page/read-recording';
import { screenshot } from '@/lib/actions/page/screenshot';
import { searchSite } from '@/lib/actions/page/search-site';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { startMonitor } from '@/lib/actions/page/start-monitor';
import { stopMonitor } from '@/lib/actions/page/stop-monitor';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { EXPIRED_MESSAGE, REFUSED_MESSAGE } from '@/lib/secrets';
import { releaseForAction, sealForPage } from '@/lib/bridge/secret-vault';
import { findCaptchaInTab, solveCaptchaInTab } from '@/lib/bridge/captcha';
import { listMeta, readBytes } from '@/lib/bridge/file-store';
import { awaitMonitorDone, monitorStatusFor, startTabMonitor, stopTabMonitor } from '@/lib/bridge/monitor';
import { listRecordings as listStoredMeta, readRecordingBody } from '@/lib/bridge/recording-store';
import { screenshotTab } from '@/lib/bridge/screenshot';
import { dragInTab, trustedClickInTab } from '@/lib/bridge/trusted-input';
import { closeOpenTab, openNewTab, switchToTab, watchForLoad, type TabRef } from '@/lib/bridge/tabs';
import { adoptSubtab, sessionForRun, sessionForTab, setCurrentTab, type TabSession } from '@/lib/bridge/tab-sessions';

/**
 * The sanitizer's client-side half, wrapped around every action the harness runs.
 *
 * In: a sealed handle becomes plaintext only if it sits in a field that types into the
 * page, and only one hop before the content script gets it. Out: whatever the page gave
 * back is scanned and sealed before it can reach the daemon, so a credential read from a
 * page never crosses the socket at all.
 */
export async function invokeForHarness(
  action: string,
  input?: unknown,
  tabId?: number,
  runId?: string,
): Promise<ActionResult> {
  const release = await releaseForAction(action, input);
  if (release.refused.length) return failure('SECRET_NOT_RELEASABLE', REFUSED_MESSAGE);
  if (release.unresolved.length) return failure('SECRET_EXPIRED', EXPIRED_MESSAGE);

  const result = await dispatch(action, release.input, tabId, runId);
  const { value } = await sealForPage(result, await targetOrigin(tabId, runId));
  return value;
}

async function targetOrigin(tabId?: number, runId?: string): Promise<string | undefined> {
  const owner = runId ? await sessionForRun(runId) : null;
  const tab = await resolveTab(tabId, owner);
  return tab?.url ? hostOf(tab.url) : undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

async function dispatch(
  action: string,
  input: unknown,
  tabId?: number,
  runId?: string,
): Promise<ActionResult> {
  if (action === listFiles.name) return listStoredFiles(input);
  if (action === listRecordings.name) return listStoredRecordings(input);
  if (action === readRecording.name) return readStoredRecording(input);

  const owner = runId ? await sessionForRun(runId) : null;
  if (action === openTab.name) return openSessionTab(input, owner);
  if (action === startMonitor.name) return beginMonitor(input, tabId ?? owner?.currentTabId);
  if (action === monitorStatus.name) return statusOfMonitors(input);
  if (action === stopMonitor.name) return stopRequestedMonitor(input);
  if (action === awaitMonitor.name) return awaitRequestedMonitor(input);

  const tab = await resolveTab(tabId, owner);
  if (tab?.id == null) {
    if (owner) {
      return failure('SESSION_TAB_CLOSED', 'The tab this conversation was working in has been closed.');
    }
    return tabId == null
      ? failure('NO_ACTIVE_TAB', 'No active tab to control')
      : failure('MAPPING_TAB_CHANGED', 'The tab this run started in has been closed.');
  }
  if (action === navigate.name) return navigateTab(tab.id, input);
  if (action === searchSite.name) return searchTab(tab.id, input);
  if (action === switchTab.name) return switchSessionTab({ id: tab.id, windowId: tab.windowId }, input, owner);
  if (action === closeTab.name) return closeOpenTab({ id: tab.id, windowId: tab.windowId }, input);
  if (action === screenshot.name) return screenshotTab({ id: tab.id, windowId: tab.windowId }, input, runId);
  if (action === attachFile.name) return attachStoredFile(tab.id, input);
  if (action === trustedClick.name) return trustedClickInTab(tab.id, input);
  if (action === dragElement.name && isTrustedDrag(input)) return dragInTab(tab.id, input);
  if (action === findCaptcha.name) return findCaptchaInTab(tab.id);
  if (action === solveCaptcha.name) return solveCaptchaInTab(tab.id, input);
  return invokeInTab(tab.id, action, input);
}

function isTrustedDrag(input: unknown): boolean {
  return (input as { trusted?: unknown } | undefined)?.trusted === true;
}

async function pinnedTab(tabId: number) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function resolveTab(tabId: number | undefined, owner: TabSession | null) {
  if (owner) return (await pinnedTab(owner.currentTabId)) ?? (await pinnedTab(owner.mainTabId));
  if (tabId != null) return pinnedTab(tabId);
  return (await browser.tabs.query({ active: true, currentWindow: true }))[0];
}

async function openSessionTab(input: unknown, owner: TabSession | null): Promise<ActionResult> {
  if (!owner) return openNewTab(input);
  const anchor = (await pinnedTab(owner.currentTabId)) ?? (await pinnedTab(owner.mainTabId));
  const result = await openNewTab(input, anchor?.id != null ? { id: anchor.id, windowId: anchor.windowId } : undefined);
  if (!result.ok) return result;
  const opened = (result.data as { tabId?: unknown; activeTabId?: unknown }).tabId;
  if (typeof opened === 'number') {
    await adoptSubtab(owner.sessionId, opened, (result.data as { activeTabId?: unknown }).activeTabId === opened);
  }
  return result;
}

async function switchSessionTab(current: TabRef, input: unknown, owner: TabSession | null): Promise<ActionResult> {
  if (!owner) return switchToTab(current, input);

  const wanted = (input ?? {}) as { tabId?: unknown };
  if (typeof wanted.tabId === 'number' && !owner.tabIds.includes(wanted.tabId)) {
    const other = await sessionForTab(wanted.tabId);
    if (other) {
      return failure(
        'TAB_IN_USE',
        `Another Browsentic conversation is working in tab ${wanted.tabId}. Leave it alone, or ask the user to end that session first.`,
      );
    }
  }

  const result = await switchToTab(current, input);
  if (!result.ok) return result;
  const landed = (result.data as { activeTabId?: unknown }).activeTabId;
  if (typeof landed !== 'number' || landed === current.id) return result;

  if (owner.tabIds.includes(landed)) await setCurrentTab(owner.sessionId, landed);
  else if (!(await sessionForTab(landed))) await adoptSubtab(owner.sessionId, landed, true);
  return result;
}

async function beginMonitor(input: unknown, tabId?: number): Promise<ActionResult> {
  const parsed = startMonitor.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return startTabMonitor(parsed.data, tabId);
}

async function statusOfMonitors(input: unknown): Promise<ActionResult> {
  const parsed = monitorStatus.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return monitorStatusFor(parsed.data.monitorId);
}

async function stopRequestedMonitor(input: unknown): Promise<ActionResult> {
  const parsed = stopMonitor.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return stopTabMonitor(parsed.data.monitorId);
}

async function awaitRequestedMonitor(input: unknown): Promise<ActionResult> {
  const parsed = awaitMonitor.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return awaitMonitorDone(parsed.data.monitorId, parsed.data.timeoutMs);
}

async function listStoredFiles(input: unknown): Promise<ActionResult> {
  const filter = (input as { nameContains?: unknown } | undefined)?.nameContains;
  const needle = typeof filter === 'string' ? filter.toLowerCase() : null;
  const files = (await listMeta())
    .filter((f) => !needle || f.name.toLowerCase().includes(needle))
    .map(({ id, name, mime, size, status, summary, addedAt }) => ({ id, name, mime, size, status, summary, addedAt }));
  return success({ files });
}

async function listStoredRecordings(input: unknown): Promise<ActionResult> {
  const filters = input as { host?: unknown; nameContains?: unknown } | undefined;
  const host = typeof filters?.host === 'string' ? filters.host.toLowerCase() : null;
  const needle = typeof filters?.nameContains === 'string' ? filters.nameContains.toLowerCase() : null;
  const recordings = (await listStoredMeta())
    .filter((r) => !host || r.host.toLowerCase() === host)
    .filter((r) => !needle || `${r.name} ${r.goal ?? ''}`.toLowerCase().includes(needle))
    .map(({ id, name, host: on, status, goal, summary, steps, capturedValues, durationMs, createdAt }) => ({
      id,
      name,
      host: on,
      status,
      goal,
      summary,
      steps,
      capturedValues,
      durationMs,
      createdAt,
    }));
  return success({ recordings });
}

async function readStoredRecording(input: unknown): Promise<ActionResult> {
  const id = (input as { recordingId?: unknown } | undefined)?.recordingId;
  if (typeof id !== 'string' || !id) {
    return failure('INVALID_INPUT', 'Provide the "recordingId" of a recording from page.listRecordings.');
  }
  const meta = (await listStoredMeta()).find((r) => r.id === id);
  if (!meta) return failure('RECORDING_NOT_FOUND', `No recording with id "${id}".`);
  const body = await readRecordingBody(id);
  if (!body?.workflow) {
    return failure(
      'RECORDING_NOT_READY',
      meta.status === 'error'
        ? `That recording could not be turned into steps: ${meta.error ?? 'unknown error'}`
        : 'That recording is still being turned into steps — try again shortly.',
    );
  }
  return success({
    id: meta.id,
    name: meta.name,
    host: meta.host,
    startUrl: meta.startUrl,
    capturedValues: meta.capturedValues,
    durationMs: meta.durationMs,
    goal: body.workflow.goal,
    summary: body.workflow.summary,
    variables: body.workflow.variables,
    caveats: body.workflow.caveats,
    steps: body.workflow.steps,
  });
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

const FIELD_SETTLE_MS = 2_000;

async function searchTab(tabId: number, input: unknown): Promise<ActionResult> {
  const inPage = await invokeInTab(tabId, searchSite.name, input);
  if (!inPage.ok) return inPage;
  const searched = inPage.data as { via?: unknown; submitted?: unknown };
  const loaded = await settleAfterSearch(tabId, searched.via === 'url' || searched.submitted === true);
  return success({ ...(inPage.data as object), loaded, landedOn: (await pinnedTab(tabId))?.url });
}

async function settleAfterSearch(tabId: number, navigating: boolean): Promise<boolean> {
  const watcher = watchForLoad(tabId);
  if (navigating) return watcher.settled;
  const raced = await Promise.race([
    watcher.settled,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FIELD_SETTLE_MS)),
  ]);
  if (raced === null) watcher.cancel();
  return raced ?? false;
}
