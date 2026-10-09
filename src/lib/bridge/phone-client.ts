import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { BRIDGE_CHANNEL, failure, type ActionResult } from '@/lib/actions/protocol';
import { PHONE_KEY, readPhone, type PhoneSession } from './phone';
import { useActiveTab } from './use-active-tab';

export type PhoneRequest = { op: 'phoneStart'; serial: string; windowId?: number } | { op: 'phoneEnd' } | { op: 'phoneOpenChrome' };

export async function askPhone<T = PhoneSession>(request: PhoneRequest): Promise<ActionResult<T>> {
  const result = (await browser.runtime
    .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
    .catch(() => null)) as ActionResult<T> | null;
  return result ?? failure('BRIDGE_ERROR', 'The extension did not answer — reload it and try again.');
}

export function usePhoneSession(): PhoneSession | null {
  const [session, setSession] = useState<PhoneSession | null>(null);

  useEffect(() => {
    let current = true;
    void readPhone().then((stored) => current && setSession(stored));
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (PHONE_KEY in changes) setSession((changes[PHONE_KEY].newValue as PhoneSession | undefined) ?? null);
    };
    browser.storage.session.onChanged.addListener(listener);
    return () => {
      current = false;
      browser.storage.session.onChanged.removeListener(listener);
    };
  }, []);

  return session;
}

/** The phone session whose mirror is the active tab, matched by tab id: without the `tabs` permission an extension page's URL is hidden. */
export function useMirroredPhone(): PhoneSession | null {
  const { tabId } = useActiveTab();
  const phone = usePhoneSession();
  return tabId !== undefined && phone?.mirrorTabId === tabId ? phone : null;
}
