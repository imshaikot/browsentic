import type { AdbServer } from './adb-server';
import { CHROME_PACKAGE, DEVTOOLS_SOCKET, isDebuggable } from './phone-facts';

const CHROME_ACTIVITY = `${CHROME_PACKAGE}/com.google.android.apps.chrome.Main`;
const SOCKET_WAIT_MS = 10_000;
const SOCKET_POLL_MS = 250;
const AM_TIMEOUT_MS = 10_000;

export const INSTALL_CHROME_COMMAND = `am start -a android.intent.action.VIEW -d 'market://details?id=${CHROME_PACKAGE}'`;

/**
 * With a URL this is a VIEW intent, which opens a new tab every time Chrome is already running:
 * only a person asking for that page sends one, and a session opens its pages over DevTools.
 */
export function launchChromeCommand(url?: string): string {
  const target = url && webUrl(url);
  return target
    ? `am start -a android.intent.action.VIEW -d '${target.replaceAll("'", "'\\''")}' -n ${CHROME_ACTIVITY}`
    : `am start -n ${CHROME_ACTIVITY}`;
}

function webUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Starts Chrome and waits until its DevTools socket is open: 2 to 5 seconds from a cold start. */
export async function launchChrome(server: AdbServer, serial: string, url?: string): Promise<boolean> {
  await server.shell(serial, launchChromeCommand(url), AM_TIMEOUT_MS);
  const deadline = Date.now() + SOCKET_WAIT_MS;
  while (Date.now() < deadline) {
    if (isDebuggable(await server.shell(serial, `grep ${DEVTOOLS_SOCKET} /proc/net/unix`).catch(() => ''))) return true;
    await new Promise((resolve) => setTimeout(resolve, SOCKET_POLL_MS));
  }
  return false;
}

export async function openChromeListing(server: AdbServer, serial: string): Promise<void> {
  await server.shell(serial, INSTALL_CHROME_COMMAND, AM_TIMEOUT_MS);
}
