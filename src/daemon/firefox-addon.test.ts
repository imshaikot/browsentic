import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

/** GitHub's release downloads, carrying exactly the assets the test says. */
let attached: string[] = [];
let hang = false;
const asked: IncomingMessage[] = [];
const releases = createServer((request, response) => {
  asked.push(request);
  if (hang) return;
  response.writeHead(attached.some((asset) => request.url?.endsWith(asset)) ? 200 : 404);
  response.end();
});

let addon: typeof import('./firefox-addon');

beforeAll(async () => {
  await new Promise<void>((resolve) => releases.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('BROWSENTIC_RELEASES', `http://127.0.0.1:${(releases.address() as AddressInfo).port}/releases`);
  vi.resetModules();
  addon = await import('./firefox-addon');
});

afterAll(async () => {
  releases.closeAllConnections();
  await new Promise((resolve) => releases.close(resolve));
});

describe('the signed Firefox add-on', () => {
  test('hangs under the release of the same version, named the way the release job names it', () => {
    expect(addon.signedAddonUrl('0.7.0')).toMatch(/\/releases\/download\/v0\.7\.0\/browsentic-0\.7\.0-firefox\.xpi$/);
    expect(addon.RELEASES_PAGE).toMatch(/\/releases\/latest$/);
  });

  test('is attached once Mozilla has signed it, and asked for with HEAD, never downloaded', async () => {
    attached = ['browsentic-0.7.0-firefox.xpi'];
    expect(await addon.signedAddonAttached('0.7.0')).toBe(true);
    expect(asked.at(-1)?.method).toBe('HEAD');
  });

  test('is not attached while the release is still waiting on Mozilla', async () => {
    attached = [];
    expect(await addon.signedAddonAttached('0.7.0')).toBe(false);
  });

  test('is unknown, not absent, when GitHub cannot be reached', async () => {
    hang = true;
    try {
      expect(await addon.signedAddonAttached('0.7.0', 50)).toBeNull();
    } finally {
      hang = false;
    }
  });
});
