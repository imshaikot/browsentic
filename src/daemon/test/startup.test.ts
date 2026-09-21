import { get } from 'node:http';
import { homedir } from 'node:os';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DAEMON_PORTS } from '@/lib/actions/protocol';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile, stateDir } from '../lockfile';

describe('a daemon started in the sandbox', () => {
  let daemon: Daemon;
  beforeAll(async () => {
    daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
  });
  afterAll(async () => {
    await daemon?.stop();
  });

  test('binds a port the OS picked, never one a real daemon would use', () => {
    expect(DAEMON_PORTS).not.toContain(daemon.port);
  });

  test('writes its lockfile inside the sandboxed home', () => {
    expect(stateDir.startsWith(homedir())).toBe(true);
    expect(readLockfile()).toMatchObject({ pid: process.pid, port: daemon.port, daemonVersion: '0.0.0-test' });
  });

  test('answers /health on the port it recorded', async () => {
    const response = await fetch(`http://127.0.0.1:${readLockfile()?.port}/health`);
    expect(await response.json()).toEqual({ ok: true, pid: process.pid, version: '0.0.0-test', connected: false });
  });

  test('does not list the page-code tools to a caller its policy would only refuse', async () => {
    const names = (await daemon.describe()).tools.map((tool) => tool.name);
    expect([names.includes('page.getPageInfo'), names.includes('page.injectCode'), names.includes('page.runCode')]).toEqual([true, false, false]);
  });

  // fetch() will not send a Host of the caller's choosing, and a rebound page's Host is the whole point.
  test('turns away a host that is not loopback', async () => {
    const status = await new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port: daemon.port, path: '/health', headers: { host: 'evil.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(status).toBe(403);
  });
});
