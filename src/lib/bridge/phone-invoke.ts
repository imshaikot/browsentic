import { browser } from 'wxt/browser';
import { z } from 'zod';
import { ActionError } from '@/lib/actions/core';
import { closeTab } from '@/lib/actions/page/close-tab';
import { navigate, resolveNavigation, type NavigateInput } from '@/lib/actions/page/navigate';
import { openTab } from '@/lib/actions/page/open-tab';
import { switchTab } from '@/lib/actions/page/switch-tab';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { EXPIRED_MESSAGE, REFUSED_MESSAGE } from '@/lib/secrets';
import { notOnPhone, phoneOffers } from '@/lib/phone/features';
import { isLive, readPhone, targetForNumber, updatePhone, numbered, type PhoneSession } from './phone';
import { attachedSession, bringToFront, followTarget } from './phone-mirror';
import { releaseForAction, sealForPage } from './secret-vault';
import { refusalFor } from './site-guard';
import { sendCdp } from './socket';
import { sessionForRun, type TabSession } from './tab-sessions';

const GONE = 'The phone disconnected. Reconnect it and switch Android on again.';
const LOAD_TIMEOUT_MS = 15_000;
const LOAD_POLL_MS = 150;

/** Pages a tool lands on, checked against the blocked list once it has run. */
const LANDS = new Set([navigate.name, openTab.name, 'page.searchSite', 'page.submitForm', 'page.clickElement', 'page.trustedClick']);

type PhoneBackend = (action: string, input: unknown, phone: PhoneSession) => Promise<ActionResult>;

const pageSide: PhoneBackend = async (action) => failure('NOT_BUILT', `${action} is not built for the phone yet.`);

/**
 * The phone session a call belongs to: its run's conversation lives on the phone tab, or, with no
 * run, the tab it resolves to is the phone tab. Null for every desktop call.
 */
export async function phoneRoute(tabId: number | undefined, runId: string | undefined): Promise<PhoneSession | 'gone' | null> {
  const owner: TabSession | null = runId ? await sessionForRun(runId) : null;
  const phone = await readPhone();
  if (owner) return owner.phone ? (isLive(phone) && phone ? phone : 'gone') : null;
  if (!phone) return null;
  const tab = tabId ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tab !== phone.mirrorTabId) return null;
  return isLive(phone) ? phone : 'gone';
}

export const currentTarget = (phone: PhoneSession) => phone.targets.find((target) => target.targetId === phone.activeTargetId) ?? phone.targets[0];

export async function invokeOnPhone(action: string, input: unknown, route: PhoneSession | 'gone'): Promise<ActionResult> {
  if (route === 'gone') return failure('PHONE_GONE', GONE);
  if (!phoneOffers(action)) return failure('NOT_ON_PHONE', notOnPhone(action));

  const here = currentTarget(route)?.url;
  const refused = await refusalFor(here, ...destinationsOf(action, input, here));
  if (refused) return refused;

  const release = await releaseForAction(action, input);
  if (release.refused.length) return failure('SECRET_NOT_RELEASABLE', REFUSED_MESSAGE);
  if (release.unresolved.length) return failure('SECRET_EXPIRED', EXPIRED_MESSAGE);

  const result = await (TAB_TOOLS[action] ?? pageSide)(action, release.input, route);
  if (result.ok && LANDS.has(action)) {
    const landed = await refusalFor(currentTarget((await readPhone()) ?? route)?.url, textOf((result.data as { finalUrl?: unknown })?.finalUrl));
    if (landed) return landed;
  }
  const { value } = await sealForPage(result, hostOf(currentTarget((await readPhone()) ?? route)?.url));
  return value;
}

function destinationsOf(action: string, input: unknown, base?: string): (string | undefined)[] {
  const url = (input as { url?: unknown } | undefined)?.url;
  if ((action !== navigate.name && action !== openTab.name) || typeof url !== 'string') return [];
  try {
    return [new URL(url, base).href];
  } catch {
    return [];
  }
}

const TAB_TOOLS: Record<string, PhoneBackend> = {
  [navigate.name]: navigateOnPhone,
  [openTab.name]: openPhoneTab,
  [switchTab.name]: switchPhoneTab,
  [closeTab.name]: closePhoneTab,
};

export async function inCurrentTab(phone: PhoneSession, method: string, params?: Record<string, unknown>) {
  const target = currentTarget(phone);
  const sessionId = target && (await attachedSession(phone.serial, target.targetId));
  return sessionId ? sendCdp(phone.serial, method, params, sessionId) : failure('PHONE_GONE', GONE);
}

async function loaded(phone: PhoneSession, sinceUrl?: string): Promise<{ url: string; title: string; loaded: boolean }> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let seen = { url: sinceUrl ?? '', title: '', readyState: '' };
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS));
    const state = await inCurrentTab(phone, 'Runtime.evaluate', {
      expression: 'JSON.stringify({ url: location.href, title: document.title, readyState: document.readyState })',
      returnByValue: true,
    });
    if (!state.ok) continue;
    seen = JSON.parse(String((state.data.result as { value?: unknown }).value ?? '{}'));
    if (seen.readyState === 'complete' && seen.url !== 'about:blank') return { url: seen.url, title: seen.title, loaded: true };
  }
  return { url: seen.url, title: seen.title, loaded: false };
}

async function navigateOnPhone(_action: string, input: unknown, phone: PhoneSession): Promise<ActionResult> {
  const parsed = navigate.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  let plan;
  try {
    plan = resolveNavigation(parsed.data as NavigateInput, currentTarget(phone)?.url);
  } catch (error) {
    return error instanceof ActionError ? failure(error.code, error.message) : failure('ACTION_FAILED', String(error));
  }
  if (plan.kind === 'url') {
    const went = await inCurrentTab(phone, 'Page.navigate', { url: plan.href });
    if (!went.ok) return went;
    if (went.data.errorText) return failure('NAVIGATION_FAILED', `The phone could not open ${plan.href}: ${went.data.errorText}`);
    const landing = await loaded(phone);
    return success({ navigatedTo: plan.href, finalUrl: landing.url, title: landing.title, loaded: landing.loaded });
  }
  if (plan.action === 'reload') {
    const reloaded = await inCurrentTab(phone, 'Page.reload');
    if (!reloaded.ok) return reloaded;
  } else {
    const history = await inCurrentTab(phone, 'Page.getNavigationHistory');
    if (!history.ok) return history;
    const entries = (history.data.entries as { id: number }[] | undefined) ?? [];
    const entry = entries[Number(history.data.currentIndex) + (plan.action === 'back' ? -1 : 1)];
    if (!entry) return failure('ACTION_FAILED', `Cannot go ${plan.action}: this phone tab has no ${plan.action === 'back' ? 'previous' : 'next'} page in its history.`);
    const went = await inCurrentTab(phone, 'Page.navigateToHistoryEntry', { entryId: entry.id });
    if (!went.ok) return went;
  }
  const landing = await loaded(phone);
  return success({ performed: plan.action, finalUrl: landing.url, title: landing.title, loaded: landing.loaded });
}

async function openPhoneTab(_action: string, input: unknown, phone: PhoneSession): Promise<ActionResult> {
  const parsed = openTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { url, active } = parsed.data;
  const previous = currentTarget(phone);
  let href: string;
  try {
    const plan = resolveNavigation({ url }, previous?.url);
    if (plan.kind !== 'url') return failure('INVALID_INPUT', 'page.openTab opens a URL — it has no history to walk.');
    href = plan.href;
  } catch (error) {
    return error instanceof ActionError ? failure(error.code, error.message) : failure('ACTION_FAILED', String(error));
  }
  const created = await sendCdp(phone.serial, 'Target.createTarget', { url: href });
  if (!created.ok) return created;
  const targetId = String(created.data.targetId);
  const held = await updatePhone((session) => numbered(session, session.targets.some((each) => each.targetId === targetId) ? session.targets : [...session.targets, { targetId, url: href, title: '' }]));
  const tabId = held?.tabNumbers?.[targetId];
  if (active === false && previous) {
    await bringToFront(phone.serial, previous.targetId);
    return success({
      performed: `opened ${href} in a new phone tab, then went back to tab ${phone.tabNumbers?.[previous.targetId]}; the phone shows a new tab in front for a moment, since Chrome on Android opens every new tab there`,
      openedUrl: href,
      tabId,
      activeTabId: phone.tabNumbers?.[previous.targetId],
    });
  }
  await followTarget(targetId);
  const landing = await loaded({ ...phone, ...held, activeTargetId: targetId });
  return success({ performed: `opened ${href} in a new phone tab`, openedUrl: href, finalUrl: landing.url, tabId, loaded: landing.loaded, activeTabId: tabId, previousTabId: previous && phone.tabNumbers?.[previous.targetId] });
}

const describeTabs = (phone: PhoneSession) =>
  phone.targets.map((target) => ({ tabId: phone.tabNumbers?.[target.targetId], url: target.url, title: target.title, active: target.targetId === phone.activeTargetId }));

async function switchPhoneTab(_action: string, input: unknown, phone: PhoneSession): Promise<ActionResult> {
  const parsed = switchTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { tabId, match } = parsed.data;
  if (tabId == null && match == null) return success({ tabs: describeTabs(phone) });
  const targetId =
    tabId != null
      ? targetForNumber(phone, tabId)
      : phone.targets.find((target) => `${target.title} ${target.url}`.toLowerCase().includes(String(match).toLowerCase()))?.targetId;
  const target = phone.targets.find((each) => each.targetId === targetId);
  if (!target) return failure('INVALID_TARGET', `No phone tab matches. The phone's tabs: ${JSON.stringify(describeTabs(phone))}`);
  const refused = await refusalFor(target.url);
  if (refused) return refused;
  await bringToFront(phone.serial, target.targetId);
  await followTarget(target.targetId);
  return success({ performed: `switched to phone tab ${phone.tabNumbers?.[target.targetId]}`, activeTabId: phone.tabNumbers?.[target.targetId], tab: { url: target.url, title: target.title } });
}

async function closePhoneTab(_action: string, input: unknown, phone: PhoneSession): Promise<ActionResult> {
  const parsed = closeTab.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { tabId, match } = parsed.data;
  const targetId =
    tabId != null
      ? targetForNumber(phone, tabId)
      : match != null
        ? phone.targets.find((target) => `${target.title} ${target.url}`.toLowerCase().includes(String(match).toLowerCase()))?.targetId
        : phone.activeTargetId;
  const target = phone.targets.find((each) => each.targetId === targetId);
  if (!target) return failure('INVALID_TARGET', `No phone tab matches. The phone's tabs: ${JSON.stringify(describeTabs(phone))}`);
  if (phone.targets.length <= 1) return failure('INVALID_TARGET', 'That is the only tab open on the phone. Open another first, or leave this one alone.');
  const closed = await sendCdp(phone.serial, 'Target.closeTarget', { targetId: target.targetId });
  if (!closed.ok) return closed;
  return success({ performed: `closed phone tab ${phone.tabNumbers?.[target.targetId]}`, closed: { url: target.url, title: target.title } });
}

const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.toLowerCase() || undefined : undefined;
  } catch {
    return undefined;
  }
}
