import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { attachFile } from '@/lib/actions/page/attach-file';
import { awaitMonitor } from '@/lib/actions/page/await-monitor';
import { captureDownload } from '@/lib/actions/page/capture-download';
import { closeTab } from '@/lib/actions/page/close-tab';
import { dragElement } from '@/lib/actions/page/drag-element';
import { findCaptcha } from '@/lib/actions/page/find-captcha';
import { listFiles } from '@/lib/actions/page/list-files';
import { listRecordings } from '@/lib/actions/page/list-recordings';
import { monitorStatus } from '@/lib/actions/page/monitor-status';
import { navigate, resolveNavigation, type NavigateInput } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { pickElement } from '@/lib/actions/page/pick-element';
import { readConsole } from '@/lib/actions/page/read-console';
import { readNetwork } from '@/lib/actions/page/read-network';
import { readRecording } from '@/lib/actions/page/read-recording';
import { screenshot } from '@/lib/actions/page/screenshot';
import { searchSite } from '@/lib/actions/page/search-site';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { startDiagnostics } from '@/lib/actions/page/start-diagnostics';
import { startMonitor } from '@/lib/actions/page/start-monitor';
import { startTimer } from '@/lib/actions/page/start-timer';
import { stopDiagnostics } from '@/lib/actions/page/stop-diagnostics';
import { stopMonitor } from '@/lib/actions/page/stop-monitor';
import { stopTimer } from '@/lib/actions/page/stop-timer';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { timerStatus } from '@/lib/actions/page/timer-status';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { EXPIRED_MESSAGE, REFUSED_MESSAGE } from '@/lib/secrets';
import { releaseForAction, sealForPage } from '@/lib/bridge/secret-vault';
import { findCaptchaInTab, solveCaptchaInTab } from '@/lib/bridge/captcha';
import { captureFromPage } from '@/lib/bridge/downloads';
import { listMeta, readBytes } from '@/lib/bridge/file-store';
import {
  readConsoleFor,
  readNetworkFor,
  startTabDiagnostics,
  stopTabDiagnostics,
} from '@/lib/bridge/diagnostics';
import { awaitMonitorDone, monitorStatusFor, startTabMonitor, stopTabMonitor } from '@/lib/bridge/monitor';
import { startJobTimer, stopJobTimer, timerStatusFor } from '@/lib/bridge/timer';
import { listRecordings as listStoredMeta, readRecordingBody } from '@/lib/bridge/recording-store';
import { pickInTab } from '@/lib/bridge/pick';
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
  if (action === startDiagnostics.name) return beginDiagnostics(input, tabId ?? owner?.currentTabId, owner?.sessionId);
  if (action === readConsole.name) return readPageConsole(input);
  if (action === readNetwork.name) return readPageNetwork(input);
  if (action === stopDiagnostics.name) return stopRequestedDiagnostics(input);
  if (action === startMonitor.name) return beginMonitor(input, tabId ?? owner?.currentTabId);
  if (action === monitorStatus.name) return statusOfMonitors(input);
  if (action === stopMonitor.name) return stopRequestedMonitor(input);
  if (action === awaitMonitor.name) return awaitRequestedMonitor(input);
  if (action === startTimer.name) return beginTimer(input, owner?.sessionId);
  if (action === timerStatus.name) return statusOfTimers(input);
  if (action === stopTimer.name) return stopRequestedTimer(input);

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
  if (action === pickElement.name) return pickInTab({ id: tab.id, windowId: tab.windowId }, input);
  if (action === attachFile.name) return attachStoredFile(tab.id, input);
  if (action === captureDownload.name) return captureFromPage(tab.id, input);
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

async function beginDiagnostics(input: unknown, tabId?: number, owner?: string): Promise<ActionResult> {
  const parsed = startDiagnostics.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return startTabDiagnostics(parsed.data, tabId, owner);
}

async function readPageConsole(input: unknown): Promise<ActionResult> {
  const parsed = readConsole.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return readConsoleFor(parsed.data);
}

async function readPageNetwork(input: unknown): Promise<ActionResult> {
  const parsed = readNetwork.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return readNetworkFor(parsed.data);
}

async function stopRequestedDiagnostics(input: unknown): Promise<ActionResult> {
  const parsed = stopDiagnostics.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return stopTabDiagnostics(parsed.data.diagnosticsId);
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

async function beginTimer(input: unknown, sessionId?: string): Promise<ActionResult> {
  const parsed = startTimer.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return startJobTimer(parsed.data, sessionId);
}

async function statusOfTimers(input: unknown): Promise<ActionResult> {
  const parsed = timerStatus.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return timerStatusFor(parsed.data.timerId);
}

async function stopRequestedTimer(input: unknown): Promise<ActionResult> {
  const parsed = stopTimer.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  return stopJobTimer(parsed.data.timerId);
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

/** A captured download arrives with its bytes already filled in by the daemon, which is the
 * only side that has them; a stored file is resolved here, where the store lives. */
async function attachStoredFile(tabId: number, input: unknown): Promise<ActionResult> {
  const args = (input ?? {}) as { fileId?: unknown; target?: unknown; content?: unknown };
  if (typeof args.content === 'string' && args.content) return invokeInTab(tabId, attachFile.name, input);

  const { fileId, target } = args;
  if (typeof fileId !== 'string' || !fileId) {
    return failure(
      'INVALID_INPUT',
      'attachFile needs a "fileId" from page.listFiles or a "downloadId" from page.captureDownload.',
    );
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
