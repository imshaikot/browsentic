import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ActionResult, SocketFrame } from '@/lib/actions/protocol';
import type { Preferences } from '@/lib/settings/preferences';
import { clearAuth } from '../auth-store';
import { configPath, writeAgentModel } from '../agent/config';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

const unpacked = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const chrome: Profile = { origin: unpacked, installId: 'install-chrome-0001', browser: 'Google Chrome' };
const brave: Profile = { origin: unpacked, installId: 'install-brave-00001', browser: 'Brave' };

let daemon: Daemon;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
});

afterAll(async () => {
  await daemon?.stop();
});

beforeEach(() => rmSync(configPath, { force: true }));

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
});

async function paired(profile: Profile): Promise<FakeBrowser> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  opened.push(bridge);
  const browser = await FakeBrowser.connect(daemon.port, profile, { kind: 'pair', code: (await bridge.pair()).code });
  opened.push(browser);
  return browser;
}

type Reply = { result: ActionResult<Preferences> & { data?: Preferences } };

/** The Mac app's side of /control: it asks for the settings, subscribes, and changes them. */
async function macApp() {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}/control`, {
    headers: { authorization: `Bearer ${readLockfile()!.token}` },
  });
  opened.push(socket);
  await new Promise((resolve) => socket.once('open', resolve));
  const events: string[] = [];
  const replies = new Map<string, (frame: Reply) => void>();
  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as Reply & { id?: string; event?: string };
    if (frame.event) events.push(frame.event);
    if (frame.id) replies.get(frame.id)?.(frame);
  });
  const ask = (request: object) => {
    const id = randomUUID();
    const answered = new Promise<Reply>((resolve) => replies.set(id, resolve));
    socket.send(JSON.stringify({ id, ...request }));
    return answered;
  };
  await ask({ op: 'preferences', watch: true });
  return { events, ask };
}

const theme = (frame: SocketFrame) => (frame.t === 'preferencesInfo' && frame.result.ok ? frame.result.data.theme : undefined);

describe('settings shared by the extension and the Mac app', () => {
  test('a browser hears what config.json holds the moment it connects, with no theme until someone picks one', async () => {
    const browser = await paired(chrome);
    await vi.waitFor(() => expect(browser.preferences).not.toBeNull());
    expect(browser.preferences?.theme).toBeNull();
    expect(browser.preferences?.guardrails.rules.length).toBeGreaterThan(0);
  });

  test('a theme picked in the Mac app reaches every paired browser, and the app hears the change', async () => {
    const [first, second] = [await paired(chrome), await paired(brave)];
    const app = await macApp();

    const reply = await app.ask({ op: 'setPreference', change: { kind: 'theme', theme: 'midnight' } });
    expect(reply.result.data?.theme).toBe('midnight');

    await vi.waitFor(() => expect([first.preferences?.theme, second.preferences?.theme]).toEqual(['midnight', 'midnight']));
    expect(app.events).toContain('settings-changed');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ theme: 'midnight' });
  });

  test('a guardrail flipped in one browser reaches the other browser and the Mac app', async () => {
    const [first, second] = [await paired(chrome), await paired(brave)];
    const app = await macApp();

    const answer = await first.ask({
      t: 'setPreference',
      id: randomUUID(),
      change: { kind: 'guardrail', setting: 'fence', value: false },
    });
    expect(answer.t === 'preferencesInfo' && answer.result.ok && answer.result.data.guardrails.fence).toEqual({ enabled: false, overridden: true });

    await vi.waitFor(() => expect(second.preferences?.guardrails.fence).toEqual({ enabled: false, overridden: true }));
    await vi.waitFor(() => expect(app.events).toContain('settings-changed'));
  });

  test('a change that writes nothing new is announced to nobody', async () => {
    const [first, second] = [await paired(chrome), await paired(brave)];
    await first.ask({ t: 'setPreference', id: randomUUID(), change: { kind: 'theme', theme: 'daylight' } });
    await vi.waitFor(() => expect(second.preferences?.theme).toBe('daylight'));
    const app = await macApp();

    const again = await first.ask({ t: 'setPreference', id: randomUUID(), change: { kind: 'theme', theme: 'daylight' } });
    expect(theme(again)).toBe('daylight');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(app.events).toEqual([]);
  });

  test('a locked rule, an unknown setting and a theme that does not exist are refused and written nowhere', async () => {
    const browser = await paired(chrome);
    const answers = await Promise.all(
      [
        { kind: 'guardrail', setting: 'secret-in-url', value: 'allow' },
        { kind: 'guardrail', setting: 'no-such-rule', value: 'allow' },
        { kind: 'theme', theme: 'solarized' },
      ].map((change) => browser.ask({ t: 'setPreference', id: randomUUID(), change } as never)),
    );
    expect(answers.map((frame) => frame.t === 'preferencesInfo' && !frame.result.ok && frame.result.error.code)).toEqual([
      'INVALID_INPUT',
      'INVALID_INPUT',
      'INVALID_INPUT',
    ]);
    expect(() => readFileSync(configPath, 'utf8')).toThrow();
  });

  test('a control connection that has spoken for an agent run cannot loosen the guardrails it runs under', async () => {
    const app = await macApp();
    await app.ask({ op: 'describe', runId: 'run-under-guard' });
    const refused = await app.ask({ op: 'setPreference', change: { kind: 'guardrail', setting: 'form-submission', value: 'allow' } });
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'BLOCKED' } });
    expect(() => readFileSync(configPath, 'utf8')).toThrow();
  });

  test('a hand edit of config.json reaches every browser and the Mac app', async () => {
    const browser = await paired(chrome);
    const app = await macApp();
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ theme: 'phosphor' }));

    await vi.waitFor(() => expect(browser.preferences?.theme).toBe('phosphor'));
    expect(app.events).toContain('settings-changed');
  });

  test('a model set from the terminal reaches the browsers’ agent picker', async () => {
    const browser = await paired(chrome);
    // The first push probes every agent CLI on PATH, which is slow on a busy machine.
    await vi.waitFor(() => expect(browser.agent).not.toBeNull(), { timeout: 10_000 });
    writeAgentModel('claude', 'opus');

    await vi.waitFor(() => expect(browser.agent?.runners.find((runner) => runner.kind === 'claude')?.model).toBe('opus'), {
      timeout: 10_000,
    });
  });
});
