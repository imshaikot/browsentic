import { browser } from 'wxt/browser';
import { z } from 'zod';
import { ActionError } from '@/lib/actions/core';
import { closeTab } from '@/lib/actions/page/close-tab';
import { resolveNavigation } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { recordingStateFor } from '@/lib/bridge/recorder';
import { refusalFor, siteCheck, tabUrls } from '@/lib/bridge/site-guard';

export const LOAD_TIMEOUT_MS = 10_000;

const MAX_LABEL = 120;
const MAX_LISTED = 20;
const SUCCESSOR_POLL_MS = 50;
const SUCCESSOR_TRIES = 10;

export interface TabRef {
  id: number;
  windowId?: number;
}

interface TabInfo {
  id?: number;
  windowId?: number;
  index?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  active?: boolean;
  pinned?: boolean;
  status?: string;
}

export async function openNewTab(input: unknown, anchor?: TabRef): Promise<ActionResult> {
  const parsed = openTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { url, active } = parsed.data;

  if (!url.trim()) {
    return failure(
      'INVALID_INPUT',
      'page.openTab needs a "url" — a blank new tab is a browser page that no page action can reach.',
    );
  }

  const current = (anchor
    ? await browser.tabs.get(anchor.id).catch(() => undefined)
    : (await browser.tabs.query({ active: true, currentWindow: true }))[0]) as TabInfo | undefined;
  const usable = await usableTabs();
  const base = current && usable(current) ? current.url : undefined;

  let href: string;
  try {
    const plan = resolveNavigation({ url }, base);
    if (plan.kind !== 'url') return failure('INVALID_INPUT', 'page.openTab opens a URL — it has no history to walk.');
    href = plan.href;
  } catch (error) {
    return error instanceof ActionError ? failure(error.code, error.message) : failure('ACTION_FAILED', String(error));
  }
  const refused = await refusalFor(href);
  if (refused) return refused;

  const opener =
    current?.id != null && current.windowId != null
      ? { windowId: current.windowId, openerTabId: current.id }
      : {};

  let created: TabInfo;
  try {
    created = await browser.tabs.create({ url: href, active, ...opener });
  } catch (error) {
    return failure('ACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
  if (created.id == null) return failure('ACTION_FAILED', 'The browser opened a tab but reported no id for it.');

  const loaded = await awaitLoad(created.id);
  const activeTabId = active ? created.id : current?.id;
  return success({
    performed: `opened ${clip(href)} in a new ${active ? 'tab' : 'background tab'}`,
    openedUrl: href,
    tabId: created.id,
    index: created.index,
    loaded,
    ...(activeTabId != null ? { activeTabId } : {}),
    ...(active && current?.id != null ? { previousTabId: current.id } : {}),
  });
}

export async function switchToTab(current: TabRef, input: unknown): Promise<ActionResult> {
  const parsed = switchTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { tabId, match } = parsed.data;
  if (tabId != null && match != null) {
    return failure('INVALID_INPUT', 'Give either "tabId" or "match", not both.');
  }

  const tabs = await windowTabs(current);
  const usable = await usableTabs();
  if (tabId == null && match == null) return success(inventory(tabs, current, usable));

  const picked = await pickTab(tabs, { tabId, match }, 'switch to', usable);
  if (!picked.ok) return picked.result;
  const target = picked.tab;
  const refused = await refusalFor(...tabUrls(target));
  if (refused) return refused;

  if (!isPageUrl(target.url)) {
    return failure(
      'UNSUPPORTED',
      `Tab ${target.id} is a browser page, not a web page — page actions cannot read or act on it, so there is nothing to switch to.`,
    );
  }

  try {
    await browser.tabs.update(target.id!, { active: true });
  } catch (error) {
    return failure('ACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
  return success({
    performed: `switched to ${label(target)}`,
    activeTabId: target.id,
    previousTabId: current.id,
    tab: describeTab({ ...target, active: true }),
  });
}

export async function closeOpenTab(current: TabRef, input: unknown): Promise<ActionResult> {
  const parsed = closeTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { tabId, match } = parsed.data;
  if (tabId != null && match != null) {
    return failure('INVALID_INPUT', 'Give either "tabId" or "match", not both.');
  }

  const tabs = await windowTabs(current);
  const usable = await usableTabs();
  const picked =
    tabId == null && match == null
      ? pickCurrent(tabs, current)
      : await pickTab(tabs, { tabId, match }, 'close', usable);
  if (!picked.ok) return picked.result;
  const target = picked.tab;
  const refused = await refusalFor(...tabUrls(target));
  if (refused) return refused;

  if (tabs.length <= 1) {
    return failure(
      'INVALID_TARGET',
      `${label(target)} is the only tab in this window — closing it would close the window and the Browsentic panel with it. Open another tab first, or leave this one alone.`,
    );
  }
  if (target.pinned) {
    return failure(
      'INVALID_TARGET',
      `${label(target)} is pinned, which means the user wants to keep it. Ask them to unpin it if it really should close.`,
    );
  }
  if (!isPageUrl(target.url)) {
    return failure(
      'UNSUPPORTED',
      `Tab ${target.id} is a browser page, not a web page — Browsentic cannot see what it is, so it will not close it.`,
    );
  }
  if ((await recordingStateFor(target.id)).recording) {
    return failure(
      'INVALID_TARGET',
      `A recording is in progress in ${label(target)} — closing it would cut the recording short. Stop the recording first.`,
    );
  }

  try {
    await browser.tabs.remove(target.id!);
  } catch (error) {
    return failure('ACTION_FAILED', error instanceof Error ? error.message : String(error));
  }

  const after = await settleAfterClose(current, target.id!);
  const nowOn = after.active?.url && usable(after.active) ? clip(after.active.url) : undefined;
  return success({
    performed: nowOn ? `closed ${label(target)} — now on ${nowOn}` : `closed ${label(target)}`,
    closed: describeTab(target),
    ...(nowOn ? { nowOn } : {}),
    ...(after.active?.id != null ? { activeTabId: after.active.id } : {}),
    remaining: after.remaining,
  });
}

export function watchForLoad(tabId: number) {
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

async function awaitLoad(tabId: number): Promise<boolean> {
  const watcher = watchForLoad(tabId);
  const status = ((await browser.tabs.get(tabId).catch(() => null)) as TabInfo | null)?.status;
  if (status == null || status === 'complete') {
    watcher.cancel();
    return status === 'complete';
  }
  return watcher.settled;
}

type Picked = { ok: true; tab: TabInfo } | { ok: false; result: ActionResult };

function pickCurrent(tabs: TabInfo[], current: TabRef): Picked {
  const tab = tabs.find((t) => t.id === current.id);
  return tab
    ? { ok: true, tab }
    : { ok: false, result: failure('TARGET_NOT_FOUND', 'The tab page actions were targeting is already gone.') };
}

async function pickTab(
  tabs: TabInfo[],
  selector: { tabId?: number; match?: string },
  verb: string,
  usable: Usable,
): Promise<Picked> {
  if (selector.tabId != null) {
    const hit = tabs.find((t) => t.id === selector.tabId);
    if (hit) return { ok: true, tab: hit };
    const elsewhere = await browser.tabs.get(selector.tabId).catch(() => null);
    return {
      ok: false,
      result: elsewhere
        ? failure(
            'INVALID_TARGET',
            `Tab ${selector.tabId} is in a different browser window. Browsentic only acts within the window it was opened in — ${openTabsLine(tabs, usable)}`,
          )
        : failure(
            'TARGET_NOT_FOUND',
            `No tab with id ${selector.tabId} — it has probably been closed. ${openTabsLine(tabs, usable)}`,
          ),
    };
  }

  const needle = selector.match!.trim().toLowerCase();
  if (!needle) return { ok: false, result: failure('INVALID_INPUT', '"match" cannot be empty.') };
  const hits = tabs.filter(usable).filter((t) => `${t.title ?? ''} ${t.url ?? ''}`.toLowerCase().includes(needle));
  if (!hits.length) {
    return {
      ok: false,
      result: failure('TARGET_NOT_FOUND', `No open tab matches "${clip(selector.match!)}". ${openTabsLine(tabs, usable)}`),
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      result: failure(
        'INVALID_TARGET',
        `"${clip(selector.match!)}" matches ${hits.length} tabs, so nothing was touched — ${verb} one of them by id: ${tabLines(hits)}`,
      ),
    };
  }
  return { ok: true, tab: hits[0] };
}

function inventory(tabs: TabInfo[], current: TabRef, usable: Usable) {
  const listed = tabs.filter(usable);
  const hidden = tabs.length - listed.length;
  const shown = listed.slice(0, MAX_LISTED);
  return {
    performed: `${listed.length} open tab${listed.length === 1 ? '' : 's'} in this window`,
    activeTabId: current.id,
    tabs: shown.map(describeTab),
    ...(hidden ? { hidden } : {}),
    ...(shown.length < listed.length ? { truncated: true } : {}),
  };
}

async function settleAfterClose(
  current: TabRef,
  closedId: number,
): Promise<{ active?: TabInfo; remaining: number }> {
  let tabs: TabInfo[] = [];
  for (let attempt = 0; attempt < SUCCESSOR_TRIES; attempt++) {
    tabs = await windowTabs(current);
    const active = tabs.find((t) => t.active);
    if (active && !tabs.some((t) => t.id === closedId)) return { active, remaining: tabs.length };
    await delay(SUCCESSOR_POLL_MS);
  }
  const left = tabs.filter((t) => t.id !== closedId);
  return { active: left.find((t) => t.active), remaining: left.length };
}

async function windowTabs(current: TabRef): Promise<TabInfo[]> {
  return (await browser.tabs.query(
    current.windowId != null ? { windowId: current.windowId } : { currentWindow: true },
  )) as TabInfo[];
}

function describeTab(tab: TabInfo) {
  return {
    tabId: tab.id,
    title: clip(tab.title ?? ''),
    url: clip(tab.url ?? ''),
    ...(tab.active ? { active: true } : {}),
  };
}

function label(tab: TabInfo): string {
  const title = clip(tab.title ?? '');
  const url = clip(tab.url ?? '');
  if (title && url) return `“${title}” — ${url}`;
  return title || url || `tab ${tab.id}`;
}

function tabLines(tabs: TabInfo[]): string {
  const shown = tabs.slice(0, MAX_LISTED);
  const lines = shown.map((t) => `#${t.id} ${label(t)}`).join('; ');
  return shown.length < tabs.length ? `${lines}; …and ${tabs.length - shown.length} more` : lines;
}

function openTabsLine(tabs: TabInfo[], usable: Usable): string {
  const listed = tabs.filter(usable);
  return listed.length ? `Open tabs: ${tabLines(listed)}` : 'No other web page is open in this window.';
}

type Usable = (tab: TabInfo) => boolean;

/** A tab on a blocked site is treated like a browser page: never listed, never matched, never named. */
async function usableTabs(): Promise<Usable> {
  const blocked = await siteCheck();
  return (tab) => isPageUrl(tab.url) && !blocked(...tabUrls(tab));
}

const isPageUrl = (url: string | undefined): boolean => !!url && /^https?:/i.test(url);

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
