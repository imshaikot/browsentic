import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { stateDir } from './lockfile';
import type { InstallKind, NpxEntry } from './npx';

// How this CLI was installed depends on where the bundle sits, which a test cannot move.
const install = vi.hoisted(() => ({ kind: 'global' as InstallKind, entries: [] as NpxEntry[], pinned: null as string | null }));
vi.mock('./npx', () => ({ installKind: () => install.kind, npxEntries: () => install.entries, pinnedVersion: () => install.pinned }));

/** The registry, answering /browsentic/latest however the test says. */
let answer: { status: number; body: string } | 'hang' = { status: 200, body: JSON.stringify({ version: '0.7.0' }) };
const asked: IncomingMessage[] = [];
const registry = createServer((request, response) => {
  asked.push(request);
  if (answer === 'hang') return;
  response.writeHead(answer.status, { 'content-type': 'application/json' });
  response.end(answer.body);
});

let selfUpdate: typeof import('./self-update');

/** Stand-ins for npm, npx and browsentic that note how they were run, then exit with FAKE_<NAME>_EXIT. */
const bin = join(stateDir, 'fake-bin');
const ran = join(stateDir, 'ran.log');
const commandsRun = () => (existsSync(ran) ? readFileSync(ran, 'utf8').split('\n').filter(Boolean) : []);

beforeAll(async () => {
  await new Promise<void>((resolve) => registry.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('BROWSENTIC_REGISTRY', `http://127.0.0.1:${(registry.address() as AddressInfo).port}`);
  vi.resetModules();
  selfUpdate = await import('./self-update');

  mkdirSync(bin, { recursive: true });
  for (const name of ['npm', 'npx', 'browsentic']) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${ran}"\nexit "\${FAKE_${name.toUpperCase()}_EXIT:-0}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
});

afterAll(async () => {
  registry.closeAllConnections();
  await new Promise((resolve) => registry.close(resolve));
});

let said: MockInstance<typeof console.error>;
const stderr = () => said.mock.calls.map(([line]) => String(line)).join('');

beforeEach(() => {
  answer = { status: 200, body: JSON.stringify({ version: '0.7.0' }) };
  asked.length = 0;
  Object.assign(install, { kind: 'global', entries: [], pinned: null });
  rmSync(ran, { force: true });
  vi.stubEnv('PATH', bin);
  said = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  said.mockRestore();
});

describe('comparing versions', () => {
  const cases: [string, string, boolean][] = [
    ['0.7.0', '0.6.2', true],
    ['0.6.2', '0.6.2', false],
    ['0.6.10', '0.6.9', true],
    ['1.0.0', '0.99.99', true],
    ['0.6.2', '0.7.0', false],
    ['0.7', '0.6.9', true],
    ['0.7.0', '0.7.0-rc.1', true],
    ['0.7.0-rc.1', '0.7.0', false],
    ['0.7.0-rc.2', '0.7.0-rc.1', true],
    ['0.7.0-rc.1', '0.6.2', true],
  ];
  for (const [candidate, current, newer] of cases) {
    test(`${candidate} is ${newer ? '' : 'not '}newer than ${current}`, () => {
      expect(selfUpdate.isNewer(candidate, current)).toBe(newer);
    });
  }
});

describe('asking the registry', () => {
  test('the published version is read from the registry’s latest tag', async () => {
    expect([await selfUpdate.publishedVersion(), asked[0].url, asked[0].headers.accept]).toEqual([
      '0.7.0',
      '/browsentic/latest',
      'application/vnd.npm.install-v1+json',
    ]);
  });

  test('a registry that refuses, or answers without a version, is no answer', async () => {
    answer = { status: 404, body: '{}' };
    const refused = await selfUpdate.publishedVersion();
    answer = { status: 200, body: JSON.stringify({ name: 'browsentic' }) };
    expect([refused, await selfUpdate.publishedVersion()]).toEqual([null, null]);
  });

  test('a registry that does not answer in time is no answer, not an error', async () => {
    answer = 'hang';
    expect(await selfUpdate.publishedVersion(50)).toBeNull();
  });
});

describe('updating the command itself', () => {
  test('a version the user pinned is never upgraded past, and the registry is not even asked', async () => {
    install.pinned = '0.5.0';
    expect([await selfUpdate.upgradeCli('0.5.0', ['setup']), asked.length]).toEqual([null, 0]);
  });

  test('offline, nothing happens', async () => {
    answer = { status: 503, body: '' };
    expect([await selfUpdate.upgradeCli('0.6.2', ['setup']), commandsRun()]).toEqual([null, []]);
  });

  test('already current, nothing happens', async () => {
    expect([await selfUpdate.upgradeCli('0.7.0', ['setup']), commandsRun()]).toEqual([null, []]);
  });

  test('a source checkout is told how to update itself, and left alone', async () => {
    install.kind = 'repo';
    expect([await selfUpdate.upgradeCli('0.6.2', ['update']), commandsRun(), stderr().includes('Update it with "git pull && yarn setup".')]).toEqual([
      null,
      [],
      true,
    ]);
  });

  test('a copy the Mac app installed is left to the app', async () => {
    install.kind = 'app';
    expect([await selfUpdate.upgradeCli('0.6.2', ['update']), commandsRun(), stderr().includes('Update it from the app')]).toEqual([null, [], true]);
  });

  test('an npx run clears every stale cache and runs the same command again from the new version', async () => {
    const caches = ['a1', 'b2'].map((key) => join(stateDir, 'npx', key));
    for (const dir of caches) mkdirSync(dir, { recursive: true });
    install.kind = 'npx';
    install.entries = caches.map((dir) => ({ dir, version: '0.6.2', packages: ['browsentic@latest'], running: false }));
    expect([await selfUpdate.upgradeCli('0.6.2', ['setup', '--json']), commandsRun(), caches.map(existsSync)]).toEqual([
      0,
      ['npx -y browsentic@0.7.0 setup --json --no-self-update'],
      [false, false],
    ]);
  });

  test('an npx rerun that fails says nothing is broken, and passes its exit code on', async () => {
    install.kind = 'npx';
    vi.stubEnv('FAKE_NPX_EXIT', '2');
    expect([await selfUpdate.upgradeCli('0.6.2', ['setup']), stderr().includes('nothing is broken')]).toEqual([2, true]);
  });

  test('a global install is replaced with npm, then the command runs again under the new one', async () => {
    vi.stubEnv('FAKE_BROWSENTIC_EXIT', '3');
    expect([await selfUpdate.upgradeCli('0.6.2', ['update']), commandsRun()]).toEqual([
      3,
      ['npm install -g browsentic@0.7.0', 'browsentic update --no-self-update'],
    ]);
  });

  test('a global install npm could not replace says what to run by hand, and goes no further', async () => {
    vi.stubEnv('FAKE_NPM_EXIT', '1');
    expect([await selfUpdate.upgradeCli('0.6.2', ['update']), commandsRun(), stderr().includes('npm install -g browsentic@0.7.0')]).toEqual([
      1,
      ['npm install -g browsentic@0.7.0'],
      true,
    ]);
  });

  test('a command that is not there at all is a failure with its name', async () => {
    vi.stubEnv('PATH', join(stateDir, 'empty-bin'));
    expect([await selfUpdate.upgradeCli('0.6.2', ['update']), stderr().includes('Could not run `npm`')]).toEqual([1, true]);
  });
});
