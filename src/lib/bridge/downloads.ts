import { browser, type Browser } from 'wxt/browser';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { captureDownload, resolveTrigger } from '@/lib/actions/page/capture-download';
import { clickElement } from '@/lib/actions/page/click-element';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { z } from 'zod';

/**
 * The browser half of a capture: arm a watcher, cause the download, and hand the daemon a
 * path and the facts about what landed.
 *
 * Nothing is judged here. The extension cannot see a run’s scope and has no filesystem of
 * its own, so every refusal — host, size, file type — belongs to the daemon, which is also
 * the only side that can move the bytes anywhere. What this side owns is the history entry:
 * it is erased the moment the item is read, because the file is about to stop being where
 * that entry says it is.
 */

export interface CapturedItem {
  browserPath: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  host?: string;
}

const ARM_TIMEOUT_MS = 15_000;

export async function captureFromPage(tabId: number, input: unknown): Promise<ActionResult> {
  const parsed = captureDownload.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { target, url, timeoutMs } = parsed.data;
  try {
    resolveTrigger(parsed.data);
  } catch (error) {
    return error instanceof ActionError ? failure(error.code, error.message) : failure('INVALID_INPUT', String(error));
  }
  if (!browser.downloads) {
    return failure(
      'DOWNLOADS_UNAVAILABLE',
      'This browser build has no downloads permission — reload the Browsentic extension and accept the new permission prompt.',
    );
  }

  const watcher = watchForDownload(timeoutMs);
  let triggered: ActionResult | null = null;
  try {
    if (url) watcher.expect(await browser.downloads.download({ url }));
    else triggered = await invokeInTab(tabId, clickElement.name, { target });
  } catch (error) {
    watcher.cancel();
    return failure('DOWNLOAD_FAILED', error instanceof Error ? error.message : String(error));
  }
  if (triggered && !triggered.ok) {
    watcher.cancel();
    return triggered;
  }

  const settled = await watcher.settled;
  if (!settled.ok) return settled;
  const item = settled.data;

  try {
    await browser.downloads.erase({ id: item.id });
  } catch {}

  return success({
    triggeredBy: url ? 'url' : 'click',
    ...(triggered?.ok ? { clicked: triggered.data } : {}),
    item: describeItem(item),
  });
}

type DownloadItem = Browser.downloads.DownloadItem;

async function searchOne(id: number): Promise<DownloadItem | null> {
  const [item] = await browser.downloads.search({ id });
  return item ?? null;
}

function describeItem(item: DownloadItem): CapturedItem {
  const browserPath = item.filename;
  return {
    browserPath,
    name: baseName(browserPath),
    mime: item.mime ?? '',
    size: typeof item.fileSize === 'number' && item.fileSize > 0 ? item.fileSize : (item.totalBytes ?? 0),
    url: item.finalUrl || item.url,
    host: hostOf(item.finalUrl || item.url),
  };
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || 'download';
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

interface Watcher {
  settled: Promise<ActionResult<DownloadItem>>;
  expect(id: number): void;
  cancel(): void;
}

/**
 * A click can start a download that the browser only names some way into the transfer, so
 * the watcher latches onto the first item created after it was armed and then waits for that
 * one to reach a terminal state. `expect` narrows it to a known id for the direct-url path,
 * where there is nothing to guess.
 */
function watchForDownload(timeoutMs: number): Watcher {
  let claimed: number | null = null;
  let finish: (result: ActionResult<DownloadItem>) => void = () => {};

  const settled = new Promise<ActionResult<DownloadItem>>((resolve) => {
    finish = resolve;
  });

  const armTimer = setTimeout(() => {
    if (claimed === null) {
      done(
        failure(
          'NO_DOWNLOAD_STARTED',
          'Nothing downloaded. The click may have opened a page instead — check where the tab landed, or pass the file’s url directly.',
        ),
      );
    }
  }, Math.min(ARM_TIMEOUT_MS, timeoutMs));

  const runTimer = setTimeout(
    () => done(failure('TIMEOUT', `The download did not finish within ${timeoutMs}ms.`)),
    timeoutMs,
  );

  const onCreated = (item: { id: number }) => {
    if (claimed === null) claim(item.id);
  };

  const onChanged = (delta: { id: number; state?: { current?: string }; error?: { current?: string } }) => {
    if (delta.id !== claimed) return;
    if (delta.state?.current === 'complete') void collect(delta.id);
    else if (delta.state?.current === 'interrupted') {
      done(failure('DOWNLOAD_FAILED', `The browser stopped the download: ${delta.error?.current ?? 'interrupted'}.`));
    }
  };

  function claim(id: number): void {
    claimed = id;
    clearTimeout(armTimer);
    void settleIfDone(id);
  }

  async function settleIfDone(id: number): Promise<void> {
    const item = await searchOne(id);
    if (item?.state === 'complete') void collect(id);
    else if (item?.state === 'interrupted') {
      done(failure('DOWNLOAD_FAILED', `The browser stopped the download: ${item.error ?? 'interrupted'}.`));
    }
  }

  async function collect(id: number): Promise<void> {
    const item = await searchOne(id);
    if (!item?.filename) {
      done(failure('DOWNLOAD_FAILED', 'The download finished but the browser reported no file.'));
      return;
    }
    done(success(item));
  }

  function done(result: ActionResult<DownloadItem>): void {
    clearTimeout(armTimer);
    clearTimeout(runTimer);
    browser.downloads.onCreated.removeListener(onCreated);
    browser.downloads.onChanged.removeListener(onChanged);
    finish(result);
  }

  browser.downloads.onCreated.addListener(onCreated);
  browser.downloads.onChanged.addListener(onChanged);

  return {
    settled,
    expect: claim,
    cancel: () => done(failure('CANCELLED', 'The capture was abandoned before a download started.')),
  };
}
