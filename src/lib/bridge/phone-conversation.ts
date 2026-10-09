import { browser } from 'wxt/browser';
import type { PhoneContext } from '@/lib/phone/types';
import { isLive, readPhone } from './phone';
import { currentTarget, inCurrentTab } from './phone-invoke';
import { DAEMON_STATE_KEY, type DaemonState } from './socket';
import type { TabAnchor, TabSession } from './tab-sessions';

const DEFAULT_DENSITY = 160;

/** A conversation started on the phone tab is anchored on the phone's page, never on the extension page that shows it. */
export async function phoneAnchor(anchor: TabAnchor): Promise<{ anchor: TabAnchor; serial?: string }> {
  const phone = await readPhone();
  if (!phone || phone.mirrorTabId !== anchor.tabId) return { anchor };
  const target = currentTarget(phone);
  return { anchor: { ...anchor, url: target?.url, title: target?.title || phone.model || 'Android' }, serial: phone.serial };
}

/** What a run on the phone is told about it: the device from the Bridge, the viewport from the page as it is now. */
export async function phoneContext(session: TabSession): Promise<PhoneContext | undefined> {
  const phone = await readPhone();
  if (!session.phone || !phone || !isLive(phone)) return undefined;
  const stored = await browser.storage.session.get(DAEMON_STATE_KEY);
  const device = (stored[DAEMON_STATE_KEY] as DaemonState | undefined)?.android?.devices.find((each) => each.serial === phone.serial);
  const metrics = await inCurrentTab(phone, 'Page.getLayoutMetrics');
  const visual = (metrics.ok ? metrics.data.cssVisualViewport : undefined) as { clientWidth?: number; clientHeight?: number } | undefined;
  return {
    serial: phone.serial,
    model: device?.model ?? phone.model ?? 'Android phone',
    android: device?.android ?? '',
    chrome: device?.chrome.version ?? '',
    viewport: {
      width: Math.round(visual?.clientWidth ?? 0),
      height: Math.round(visual?.clientHeight ?? 0),
      dpr: (device?.screen?.density ?? DEFAULT_DENSITY) / DEFAULT_DENSITY,
    },
  };
}
