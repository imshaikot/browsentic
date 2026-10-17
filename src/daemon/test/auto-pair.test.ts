import { rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { CHROME_WEB_STORE, EDGE_ADD_ONS } from '@/lib/stores';
import { FIREFOX_CALLER, type GrantOutcome } from '@/lib/pairing';
import { clearAuth, listSessions, pendingPairings } from '../auth-store';
import { configPath } from '../agent/config';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

const origin = `chrome-extension://${CHROME_WEB_STORE.id}`;
const chrome: Profile = { origin, installId: 'install-auto-chrome01', browser: 'Google Chrome' };
const brave: Profile = { origin, installId: 'install-auto-brave001', browser: 'Brave' };
const firefox: Profile = { origin: 'moz-extension://5b1d7a4e-9f3c-4c2e-8d1a-0e6f2b7c9a11', installId: 'install-auto-firefox1', browser: 'Firefox' };

let daemon: Daemon;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
});

afterAll(async () => {
  await daemon?.stop();
});

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
  rmSync(configPath, { force: true });
});

async function control(runId?: string): Promise<RemoteBridge> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token, runId);
  opened.push(bridge);
  return bridge;
}

const asker = (profile: Profile, extra: { gesture?: boolean; waitMs?: number; caller?: string } = {}) => ({
  installId: profile.installId,
  caller: extra.caller ?? `${profile.origin}/`,
  browser: profile.browser,
  extensionVersion: '0.9.0',
  gesture: extra.gesture,
  waitMs: extra.waitMs,
});

async function grant(profile: Profile, extra: Parameters<typeof asker>[1] = {}): Promise<GrantOutcome> {
  const outcome = await (await control()).grant(asker(profile, extra), 30_000);
  if (!outcome) throw new Error('no answer');
  return outcome;
}

async function redeem(profile: Profile, outcome: GrantOutcome): Promise<FakeBrowser> {
  if (!('grant' in outcome)) throw new Error(`expected a grant, got ${JSON.stringify(outcome)}`);
  const browser = await FakeBrowser.connect(outcome.grant.port, profile, { kind: 'pair', code: outcome.grant.code });
  opened.push(browser);
  return browser;
}

const refusalOf = (error: unknown) => (error as { refusal?: string }).refusal;

async function setMode(mode: 'auto' | 'ask' | 'code'): Promise<void> {
  expect((await (await control()).pairing(mode))?.mode).toBe(mode);
}

describe('automatic pairing', () => {
  test('a browser pairs with a grant and no code, and comes back on its key', async () => {
    const paired = await redeem(chrome, await grant(chrome));
    expect(listSessions()).toEqual([expect.objectContaining({ installId: chrome.installId, pairedBy: 'auto' })]);
    paired.close();

    const back = await FakeBrowser.connect(daemon.port, chrome, { kind: 'session', key: paired.sessionKey });
    opened.push(back);
    expect(back.isOpen).toBe(true);
  });

  test('says the Bridge pairs by itself, and how each browser paired', async () => {
    await redeem(chrome, await grant(chrome));
    const bridge = await control();
    expect((await bridge.status()).pairing).toEqual({ mode: 'auto', approver: expect.any(String) });
    expect(await bridge.sessions()).toEqual([expect.objectContaining({ pairedBy: 'auto' })]);
  });

  test('a grant works once', async () => {
    const outcome = await grant(chrome);
    (await redeem(chrome, outcome)).close();
    await expect(redeem(chrome, outcome)).rejects.toSatisfy((error) => refusalOf(error) === 'bad-code');
  });

  test('a grant is good only for the browser it was given to, from the origin the browser vouched for', async () => {
    const outcome = await grant(chrome);
    await expect(redeem(brave, outcome)).rejects.toSatisfy((error) => refusalOf(error) === 'bad-code');
    await expect(redeem({ ...chrome, origin: `chrome-extension://${EDGE_ADD_ONS.id}` }, outcome)).rejects.toSatisfy(
      (error) => refusalOf(error) === 'bad-code',
    );
    expect((await redeem(chrome, outcome)).isOpen).toBe(true);
  });

  test('asking twice hands back the same grant', async () => {
    const first = await grant(chrome);
    const second = await grant(chrome);
    expect('grant' in first && 'grant' in second && first.grant.code === second.grant.code).toBe(true);
  });

  test('a grant never pushes out a code someone is reading off the screen', async () => {
    const bridge = await control();
    const codes = [await bridge.pair(), await bridge.pair(), await bridge.pair()].map(({ code }) => code);
    await grant(chrome);
    expect(pendingPairings()).toEqual(codes);
  });

  test('Firefox redeems a grant from its own random origin, bound by the scheme', async () => {
    const paired = await redeem(firefox, await grant(firefox, { caller: FIREFOX_CALLER }));
    expect(paired.isOpen).toBe(true);
  });

  test('a typed code still pairs, and says so', async () => {
    const { code } = await (await control()).pair();
    opened.push(await FakeBrowser.connect(daemon.port, chrome, { kind: 'pair', code }));
    expect(listSessions()).toEqual([expect.objectContaining({ pairedBy: 'code' })]);
  });

  test('pairs nothing by itself in code mode', async () => {
    await setMode('code');
    expect(await grant(chrome)).toEqual({ refused: 'off', error: expect.stringContaining('off') });
  });
});

describe('revoking', () => {
  test('keeps a browser out of automatic pairing until someone reconnects it', async () => {
    const paired = await redeem(chrome, await grant(chrome));
    expect(await (await control()).revoke(chrome.installId)).toBe(1);

    await expect(FakeBrowser.connect(daemon.port, chrome, { kind: 'session', key: paired.sessionKey })).rejects.toSatisfy(
      (error) => refusalOf(error) === 'revoked',
    );
    expect(await grant(chrome)).toMatchObject({ refused: 'revoked' });
    expect(await (await control()).blocked()).toEqual([expect.objectContaining({ installId: chrome.installId, reason: 'revoked' })]);
  });

  test('a click in that browser lets it back in, in auto mode', async () => {
    await redeem(chrome, await grant(chrome));
    await (await control()).revoke(chrome.installId);

    expect((await redeem(chrome, await grant(chrome, { gesture: true }))).isOpen).toBe(true);
    expect(await (await control()).blocked()).toEqual([]);
  });

  test('a code lets it back in too', async () => {
    await redeem(chrome, await grant(chrome));
    await (await control()).revoke(chrome.installId);
    const { code } = await (await control()).pair();

    opened.push(await FakeBrowser.connect(daemon.port, chrome, { kind: 'pair', code }));
    expect('grant' in (await grant(chrome))).toBe(true);
  });

  test('a key the Bridge never issued, or forgot, is called unknown, so the extension may pair again', async () => {
    await expect(FakeBrowser.connect(daemon.port, chrome, { kind: 'session', key: 'k'.repeat(43) })).rejects.toSatisfy(
      (error) => refusalOf(error) === 'unknown',
    );
  });
});

describe('ask mode', () => {
  test('waits for someone to allow the browser, then grants it', async () => {
    await setMode('ask');
    const approver = await control();
    let told = 0;
    approver.onPairRequestsChanged(() => told++);
    await approver.pairRequests('app');

    const asked = await grant(chrome);
    expect(asked).toMatchObject({ wait: { request: expect.any(String), approver: 'app' } });
    const [request] = await approver.pairRequests();
    expect(request).toMatchObject({ installId: chrome.installId, browser: 'Google Chrome', source: 'chrome-web-store', nonce: expect.any(String) });
    expect(told).toBeGreaterThan(0);

    expect(await approver.decide(request.id, true, 'Work Chrome')).toEqual({ ok: true });
    await redeem(chrome, await grant(chrome));
    expect(listSessions()).toEqual([expect.objectContaining({ pairedBy: 'approved', label: 'Work Chrome' })]);
  });

  test('asks once per browser, however often it asks', async () => {
    await setMode('ask');
    await grant(chrome);
    await grant(chrome);
    expect(await (await control()).pairRequests()).toHaveLength(1);
  });

  test('answers a held request the moment it is allowed', async () => {
    await setMode('ask');
    await grant(chrome);
    const approver = await control();
    const [request] = await approver.pairRequests();

    const held = grant(chrome, { waitMs: 20_000 });
    const started = Date.now();
    setTimeout(() => void approver.decide(request.id, true), 200);
    expect('grant' in (await held)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a denied browser stays out, and asking again at once changes nothing', async () => {
    await setMode('ask');
    await grant(chrome);
    const approver = await control();
    const [request] = await approver.pairRequests();
    await approver.decide(request.id, false);

    expect(await grant(chrome)).toMatchObject({ refused: 'denied' });
    expect(await grant(chrome, { gesture: true })).toMatchObject({ refused: 'denied' });
  });

  test('an allowed browser pairs by itself from then on', async () => {
    await setMode('ask');
    await grant(chrome);
    const approver = await control();
    await approver.decide((await approver.pairRequests())[0].id, true);
    (await redeem(chrome, await grant(chrome))).close();

    expect('grant' in (await grant(chrome))).toBe(true);
  });

  test('a code is consent enough', async () => {
    await setMode('ask');
    const { code } = await (await control()).pair();
    opened.push(await FakeBrowser.connect(daemon.port, chrome, { kind: 'pair', code }));

    expect('grant' in (await grant(chrome))).toBe(true);
  });
});

describe('an agent run', () => {
  test('cannot pair a browser, let one in, rename one, or change how they pair', async () => {
    const run = await control('run-under-test');
    await run.describe();

    expect(await run.grant(asker(chrome), 5_000)).toMatchObject({ refused: 'off' });
    expect(await run.decide(chrome.installId, true)).toMatchObject({ ok: false });
    expect(await run.pairing('code')).toMatchObject({ mode: 'auto', error: expect.any(String) });
    expect(await run.label(chrome.installId, 'x')).toBe(false);
  });
});

describe('the pairing setting', () => {
  test('refuses a mode it does not know', async () => {
    expect(await (await control()).pairing('sometimes' as never)).toMatchObject({ mode: 'auto', error: expect.any(String) });
  });

  test('reaches the browsers, read-only, through their preferences', async () => {
    const paired = await redeem(chrome, await grant(chrome));
    expect(paired.preferences?.pairing).toEqual({ mode: 'auto' });
    await setMode('code');
    await setMode('ask');
    while (paired.preferences?.pairing?.mode !== 'ask') await paired.frames('preferencesInfo', paired.received.filter((frame) => frame.t === 'preferencesInfo').length + 1);
    expect(paired.preferences?.pairing).toEqual({ mode: 'ask' });
  });

  test('takes back a grant already handed out when pairing is switched off', async () => {
    const outcome = await grant(chrome);
    await setMode('code');
    await expect(redeem(chrome, outcome)).rejects.toSatisfy((error) => refusalOf(error) === 'bad-code');
  });

  test('takes back a grant already handed out when the browser is revoked', async () => {
    (await redeem(chrome, await grant(chrome))).close();
    const outcome = await grant(chrome);
    await (await control()).revoke(chrome.installId);
    await expect(redeem(chrome, outcome)).rejects.toSatisfy((error) => refusalOf(error) === 'bad-code');
  });
});
