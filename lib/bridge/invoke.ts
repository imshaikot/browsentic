import { browser } from 'wxt/browser';
import { z } from 'zod';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { attachFile } from '@/lib/actions/page/attach-file';
import { awaitMonitor } from '@/lib/actions/page/await-monitor';
import { closeTab } from '@/lib/actions/page/close-tab';
import { listFiles } from '@/lib/actions/page/list-files';
import { listRecordings } from '@/lib/actions/page/list-recordings';
import { monitorStatus } from '@/lib/actions/page/monitor-status';
import { navigate, resolveNavigation, type NavigateInput } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { readRecording } from '@/lib/actions/page/read-recording';
import { screenshot } from '@/lib/actions/page/screenshot';
import { startMonitor } from '@/lib/actions/page/start-monitor';
import { stopMonitor } from '@/lib/actions/page/stop-monitor';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { listMeta, readBytes } from '@/lib/bridge/file-store';
import { awaitMonitorDone, monitorStatusFor, startTabMonitor, stopTabMonitor } from '@/lib/bridge/monitor';
import { listRecordings as listStoredMeta, readRecordingBody } from '@/lib/bridge/recording-store';
import { screenshotTab } from '@/lib/bridge/screenshot';
import { closeOpenTab, openNewTab, switchToTab, watchForLoad } from '@/lib/bridge/tabs';

export async function invokeForHarness(action: string, input?: unknown, tabId?: number): Promise<ActionResult> {
  if (action === listFiles.name) return listStoredFiles(input);
  if (action === listRecordings.name) return listStoredRecordings(input);
  if (action === readRecording.name) return readStoredRecording(input);
  if (action === openTab.name) return openNewTab(input);
  if (action === startMonitor.name) return beginMonitor(input, tabId);
  if (action === monitorStatus.name) return statusOfMonitors(input);
  if (action === stopMonitor.name) return stopRequestedMonitor(input);
  if (action === awaitMonitor.name) return awaitRequestedMonitor(input);

  const tab = tabId == null ? (await browser.tabs.query({ active: true, currentWindow: true }))[0] : await pinnedTab(tabId);
  if (tab?.id == null) {
    return tabId == null
      ? failure('NO_ACTIVE_TAB', 'No active tab to control')
      : failure('MAPPING_TAB_CHANGED', 'The tab this run started in has been closed.');
  }
  if (action === navigate.name) return navigateTab(tab.id, input);
  if (action === switchTab.name) return switchToTab({ id: tab.id, windowId: tab.windowId }, input);
  if (action === closeTab.name) return closeOpenTab({ id: tab.id, windowId: tab.windowId }, input);
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
