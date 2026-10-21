import { rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AGENT_PROTOCOL, SOCKET_PROTOCOL_VERSION } from '@/lib/actions/protocol';
import { clearAuth } from '../auth-store';
import { configPath, writeActiveAgent } from '../agent/config';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

const chrome: Profile = { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', installId: 'install-chrome-0001', browser: 'Google Chrome' };
const older = { ...chrome, protocolVersion: AGENT_PROTOCOL.deepseek! - 1 };

let daemon: Daemon;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
});

afterAll(async () => {
  await daemon?.stop();
});

beforeEach(() => {
  rmSync(configPath, { force: true });
});

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
});

async function pair(profile: Profile): Promise<FakeBrowser> {
  const control = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  opened.push(control);
  const { code } = await control.pair();
  const browser = await FakeBrowser.connect(daemon.port, profile, { kind: 'pair', code });
  opened.push(browser);
  return browser;
}

// A store copy updates when its browser decides to, and an older panel looks every agent up by kind.
describe('an agent newer than the extension', () => {
  test('is never sent to an older panel: the state and the skill catalog are refused instead', async () => {
    writeActiveAgent('deepseek');
    const browser = await pair(older);
    const [state] = await browser.frames('agentInfo');
    const [catalog] = await browser.frames('skillCatalog');
    for (const { result } of [state, catalog]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: 'UNSUPPORTED', message: expect.stringMatching(/^DeepSeek Harness needs a newer Browsentic extension/) });
    }
  });

  test('refuses that panel a run, with a word to update', async () => {
    writeActiveAgent('deepseek');
    const browser = await pair(older);
    browser.tell({ t: 'instruct', id: 'run-old', text: 'what does this page cost' });
    const [run] = await browser.frames('run');
    expect(run.event).toMatchObject({ kind: 'error', code: 'AGENT_UNUSABLE' });
  });

  test('is left out of the agents an older panel is told of while another one is active', async () => {
    writeActiveAgent('claude');
    const browser = await pair(older);
    const [state] = await browser.frames('agentInfo');
    expect(state.result.ok && state.result.data.runners.map((runner) => runner.kind)).not.toContain('deepseek');
  });

  test('reaches a panel that knows it', async () => {
    writeActiveAgent('deepseek');
    const browser = await pair({ ...chrome, protocolVersion: SOCKET_PROTOCOL_VERSION });
    const [state] = await browser.frames('agentInfo');
    expect(state.result.ok && state.result.data).toMatchObject({ active: 'deepseek', runners: expect.arrayContaining([expect.objectContaining({ kind: 'deepseek' })]) });
  });
});
