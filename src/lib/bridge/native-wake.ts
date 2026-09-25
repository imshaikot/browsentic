import { browser } from 'wxt/browser';
import { NATIVE_HOST_NAME } from '@/lib/actions/protocol';

const WAKE_EVERY_MS = 60_000;

let lastAttempt = 0;

/** Asks the browser to run the registered host, which starts a daemon if none is up. False when nothing is registered. */
export async function wakeDaemon(): Promise<boolean> {
  const now = Date.now();
  if (now - lastAttempt < WAKE_EVERY_MS) return false;
  lastAttempt = now;
  const reply = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, { op: 'ensure' }).catch(() => null);
  return (reply as { ok?: unknown } | null)?.ok === true;
}
