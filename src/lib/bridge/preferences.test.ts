import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { failure, success } from '@/lib/actions/protocol';
import type { GuardrailSettings } from '@/lib/settings/guardrails';
import type { Preferences } from '@/lib/settings/preferences';
import type { ThemeId } from '@/lib/settings/theme';

const socket = vi.hoisted(() => ({
  listener: null as ((preferences: Preferences) => void) | null,
  setPreference: vi.fn(),
}));

vi.mock('./socket', () => ({
  DAEMON_STATE_KEY: 'browsentic/daemon',
  onPreferences: (listener: (preferences: Preferences) => void) => (socket.listener = listener),
  setPreference: socket.setPreference,
}));

const { THEME_UNSYNCED_KEY, servePreferences } = await import('./preferences');

const THEME_KEY = 'browsentic/theme';
const guardrails = {} as GuardrailSettings;

/** What the socket does with a pushed snapshot: record it as the daemon's state, then hand it over. */
async function push(theme: ThemeId | null): Promise<void> {
  const preferences = { theme, guardrails };
  await fakeBrowser.storage.session.set({ 'browsentic/daemon': { connected: true, paired: true, preferences, lastChangeAt: 0 } });
  socket.listener?.(preferences);
}

const local = async () => (await fakeBrowser.storage.local.get([THEME_KEY, THEME_UNSYNCED_KEY])) as Record<string, unknown>;
const handed = () => socket.setPreference.mock.calls.map(([change]) => change.theme);

describe('one theme for this browser and config.json', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    socket.setPreference.mockReset().mockImplementation(async (change) => success({ theme: change.theme, guardrails }));
    servePreferences();
  });

  it('hands a theme picked before pairing to a daemon that has none', async () => {
    await fakeBrowser.storage.local.set({ [THEME_KEY]: 'phosphor' });
    socket.setPreference.mockClear();
    await push(null);
    await vi.waitFor(() => expect(handed()).toEqual(['phosphor']));
  });

  it('hands nothing over when nobody ever picked one, so config.json stays free of a default', async () => {
    await push(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([handed(), await local()]).toEqual([[], {}]);
  });

  it('takes the daemon’s theme, and does not send that change straight back', async () => {
    await fakeBrowser.storage.local.set({ [THEME_KEY]: 'ember' });
    await push('ember');
    socket.setPreference.mockClear();

    await push('daylight');
    await vi.waitFor(async () => expect((await local())[THEME_KEY]).toBe('daylight'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handed()).toEqual([]);
  });

  it('keeps a pick made while the daemon was unreachable, and hands it over at the next connect', async () => {
    await push('ember');
    await vi.waitFor(async () => expect((await local())[THEME_KEY]).toBe('ember'));
    socket.setPreference.mockResolvedValue(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached'));
    await fakeBrowser.storage.local.set({ [THEME_KEY]: 'midnight' });
    await vi.waitFor(async () => expect((await local())[THEME_UNSYNCED_KEY]).toBe(true));

    socket.setPreference.mockImplementation(async (change) => success({ theme: change.theme, guardrails }));
    socket.setPreference.mockClear();
    await push('ember');
    await vi.waitFor(() => expect(handed()).toEqual(['midnight']));
    await vi.waitFor(async () => expect(await local()).toEqual({ [THEME_KEY]: 'midnight' }));
  });
});
