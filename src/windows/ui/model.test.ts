import { afterEach, describe, expect, it } from 'vitest';

import type { Backend, PairLinkAct, PairRequestSummary, TrayStatus } from './backend';
import { mockBackend, type MockBackend, type Scenario } from './mock-backend';
import { Model, TABS, outcome, parseJson, short, type State } from './model';
import { splitLine } from './views/logs';

const instantly = () => Promise.resolve();
const models: Model[] = [];

function start(backend: Backend) {
  const model = new Model(backend, instantly);
  models.push(model);
  return model;
}

async function until(model: Model, done: (state: State) => boolean, limit = 3000) {
  const started = Date.now();
  while (!done(model.snapshot())) {
    if (Date.now() - started > limit) throw new Error(`gave up waiting; state was ${JSON.stringify({ phase: model.snapshot().phase, daemon: model.snapshot().daemon, checks: model.snapshot().checks })}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  models.splice(0).forEach((model) => model.dispose());
  localStorage.clear();
});

describe('reading what the CLI and the daemon say', () => {
  it('parses --json output that a warning was printed before', () => {
    const output = { ok: true, code: 0, stdout: '! browsentic 0.9.0 is published\n{"grants":[]}', stderr: '' };
    expect(parseJson(output, 'approvals')).toEqual({ grants: [] });
  });

  it('turns a failed command into its own last words, and unreadable output into advice', () => {
    expect(() => parseJson({ ok: false, code: 1, stdout: '', stderr: 'AGENT_MISSING: codex is not installed' }, 'agent')).toThrow('AGENT_MISSING');
    expect(() => parseJson({ ok: true, code: 0, stdout: 'not json', stderr: '' }, 'skills')).toThrow('Update the app');
  });

  it('throws the daemon’s own message for a refused change', () => {
    expect(() => outcome({ ok: false, error: { code: 'BLOCKED', message: 'An agent run cannot change the settings it runs under.' } })).toThrow(
      'An agent run cannot change the settings it runs under.',
    );
    expect(outcome({ ok: true, data: { theme: 'ember' } })).toEqual({ theme: 'ember' });
  });

  it('writes a Windows path under %USERPROFILE% and leaves others whole', async () => {
    const info = await mockBackend({ instant: true }).appInfo();
    expect(short('C:\\Users\\you\\.browsentic\\cli', info)).toBe('%USERPROFILE%\\.browsentic\\cli');
    expect(short('D:\\elsewhere', info)).toBe('D:\\elsewhere');
  });

  it('reads the clock time off a log line', () => {
    expect(splitLine('2026-09-27T17:10:15.381Z daemon listening on 127.0.0.1:8765')).toEqual({ time: '17:10:15', message: 'daemon listening on 127.0.0.1:8765' });
    expect(splitLine('no stamp here')).toEqual({ time: 'no', message: 'stamp here' });
  });
});

describe('the preflight', () => {
  it('finds a computer with nothing installed, and does not open the app', async () => {
    const model = start(mockBackend({ instant: true, fresh: true }));
    await model.runPreflight();
    const { checks, phase } = model.snapshot();
    expect([checks.node.kind, checks.command.kind, checks.browser.kind, checks.agent.kind]).toEqual(['missing', 'missing', 'passed', 'advisory']);
    expect(phase).toBe('preflight');
    expect(model.needsSetup).toBe(true);
  });

  it('sets everything up in one press, then opens and turns the daemon on', async () => {
    const model = start(mockBackend({ instant: true, fresh: true }));
    await model.runPreflight();
    await model.setUpEverything();
    await until(model, (state) => state.daemon === 'on');
    const { checks, phase, status } = model.snapshot();
    expect([checks.node.kind, checks.command.kind]).toEqual(['passed', 'passed']);
    expect(phase).toBe('main');
    expect(status?.port).toBe(8765);
  });

  it('opens by itself when everything is in place, and reads the shared settings once the socket is new', async () => {
    const model = start(mockBackend({ instant: true }));
    await model.runPreflight();
    await until(model, (state) => state.phase === 'main' && !!state.preferences && state.sessions.length > 0);
    expect(model.snapshot().preferences?.guardrails.rules.length).toBeGreaterThan(0);
  });

  it('finishes an update by itself when the new app carries a newer command', async () => {
    const base = mockBackend({ instant: true });
    let installed = '0.7.6';
    const backend: Backend = {
      ...base,
      appInfo: async () => {
        const info = await base.appInfo();
        return { ...info, payload: { bundled: '0.8.0', installed, current: installed === '0.8.0' } };
      },
      installPayload: async () => void (installed = '0.8.0'),
    };
    localStorage.setItem('browsentic/finishUpdateOnLaunch', 'true');
    const model = start(backend);
    await model.runPreflight();
    await until(model, (state) => state.phase === 'main');
    expect(model.snapshot().checks.command.kind).toBe('passed');
    expect(localStorage.getItem('browsentic/finishUpdateOnLaunch')).toBeNull();
  });
});

describe('the running app', () => {
  async function running() {
    const model = start(mockBackend({ instant: true }));
    await model.runPreflight();
    await until(model, (state) => state.daemon === 'on' && !!state.preferences);
    return model;
  }

  it('opens Agents, Skills, Activity and Logs as pages of Settings, and only once past the checks', async () => {
    const model = start(mockBackend({ instant: true }));
    model.openSettings('logs');
    expect(model.snapshot()).toMatchObject({ tab: 'overview', settingsSection: 'general' });
    await model.runPreflight();
    await until(model, (state) => state.phase === 'main');
    model.openSettings('agents');
    expect(model.snapshot()).toMatchObject({ tab: 'settings', settingsSection: 'agents' });
  });

  it('offers the browsers on this computer, each with the store it gets the extension from', async () => {
    const model = await running();
    await until(model, (state) => state.browserRows.length > 0);
    expect(model.offeredBrowsers.map((row) => [row.id, row.store, row.connected])).toEqual([
      ['chrome', 'Chrome Web Store', true],
      ['edge', 'Chrome Web Store', false],
      ['brave', 'Chrome Web Store', true],
      ['firefox', 'Firefox add-on', false],
    ]);
  });

  it('adds the extension to a browser by opening its store page, says it connects by itself, and keeps a code for a copy that asks', async () => {
    const model = await running();
    await until(model, (state) => state.browserRows.length > 0);
    await model.addExtension(model.offeredBrowsers.find((row) => row.id === 'edge')!);
    expect([model.snapshot().pairing?.code, model.snapshot().notice?.text]).toEqual([
      'R4TW7KXE',
      'Press “Allow extensions from other stores” if Edge shows it at the top of the page, confirm, and press “Add to Chrome”. It connects by itself. If it asks for a code, use the one below.',
    ]);
  });

  it('hands out the code to enter with the store page when browsers pair only by code', async () => {
    const model = start(mockBackend({ instant: true, scenario: 'code' }));
    await model.runPreflight();
    await until(model, (state) => state.pairingMode === 'code' && state.browserRows.length > 0);
    await model.addExtension(model.offeredBrowsers.find((row) => row.id === 'edge')!);
    expect([model.snapshot().pairing?.code, model.snapshot().notice?.text]).toEqual([
      'R4TW7KXE',
      'Press “Allow extensions from other stores” if Edge shows it at the top of the page, confirm, and press “Add to Chrome”. Then click Browsentic in Edge’s toolbar and enter the code below.',
    ]);
  });

  it('asks for a reload only where an unpacked copy runs an older build', async () => {
    const model = await running();
    expect(model.extensionNeedsReload).toBe(true);
  });

  it('hands out a pairing code and unpairs a browser, saying how many', async () => {
    const model = await running();
    await model.newPairingCode();
    expect(model.snapshot().pairing?.code).toBe('K7Q2M9');
    await model.revoke(model.snapshot().sessions[0]);
    expect(model.snapshot().notice?.text).toBe('Unpaired 1 browser.');
  });

  it('writes a guardrail and a browser theme through the daemon', async () => {
    const model = await running();
    await model.setGuardrail('form-submission', 'allow');
    await model.setBrowserTheme('midnight');
    const { preferences } = model.snapshot();
    expect(preferences?.theme).toBe('midnight');
    expect(preferences?.guardrails.rules.find((rule) => rule.id === 'form-submission')?.override).toBe('allow');
  });

  it('switches the agent and keeps the catalog it already had', async () => {
    const model = await running();
    await until(model, (state) => !!state.agents?.catalog);
    await model.selectAgent('codex');
    expect(model.snapshot().agents?.active).toBe('codex');
    expect(model.snapshot().agents?.catalog?.length).toBeGreaterThan(0);
  });

  it('turns the daemon off and back on', async () => {
    const model = await running();
    await model.setDaemon(false);
    expect(model.snapshot().daemon).toBe('off');
    await model.setDaemon(true);
    expect(model.snapshot().daemon).toBe('on');
  });

  it('remembers the window’s appearance and whether the daemon starts with the app', () => {
    const model = start(mockBackend({ instant: true }));
    model.setAppearance('dark');
    model.setStartDaemonOnLaunch(false);
    const again = start(mockBackend({ instant: true }));
    expect([again.snapshot().appearance, again.snapshot().startDaemonOnLaunch]).toEqual(['dark', false]);
  });
});

describe('the Android tab', () => {
  /** The mock backend, with a hand on its event stream and a record of what reached the control socket. */
  function phoneBackend() {
    const backend = mockBackend({ instant: true });
    const frames: Record<string, unknown>[] = [];
    let announce: (event: string) => void = () => undefined;
    return {
      frames,
      announce: (event: string) => announce(event),
      backend: {
        ...backend,
        controlRequest: (frame: Record<string, unknown>, timeoutMs?: number) => (frames.push(frame), backend.controlRequest(frame, timeoutMs)),
        onControlEvent: (listener: (event: string) => void) => ((announce = listener), backend.onControlEvent(listener)),
      } satisfies Backend,
    };
  }

  it('sits after Browsers, so Ctrl+3 opens it and About is Ctrl+5', () => {
    expect(TABS).toEqual(['overview', 'browsers', 'android', 'settings', 'about']);
  });

  it('watches for phones only while it shows, and reads the checklist the CLI prints', async () => {
    const { backend, frames } = phoneBackend();
    const model = start(backend);
    await model.runPreflight();
    await until(model, (state) => state.daemon === 'on');
    await model.watchAndroid(true);
    const android = model.snapshot().android;
    expect(android?.problem?.code).toBe('ADB_MISSING');
    expect(android?.report.sections[0].checks[0]).toMatchObject({ label: 'adb', mark: 'failed', fix: 'winget install Google.PlatformTools' });
    await model.watchAndroid(false);
    expect(frames.filter((frame) => frame.op === 'android')).toEqual([
      { op: 'android', watch: true },
      { op: 'android', watch: false },
    ]);
  });

  it('reads the phone again when the Bridge says it changed, and the Windows copy names the USB driver', async () => {
    const { backend, announce } = phoneBackend();
    const model = start(backend);
    await model.runPreflight();
    await until(model, (state) => state.daemon === 'on');
    await model.watchAndroid(true);
    announce('android-changed');
    await until(model, (state) => state.android?.problem?.code === 'NO_DEVICE');
    expect(model.snapshot().android?.problem?.message).toMatch(/USB driver/);
  });

  it('opens Chrome on the phone through the Bridge, and remembers that a phone has been ready', async () => {
    const { backend, frames } = phoneBackend();
    const model = start(backend);
    await model.runPreflight();
    await until(model, (state) => state.daemon === 'on');
    await model.watchAndroid(true);
    for (const code of ['NO_DEVICE', 'DEVICE_UNAUTHORIZED', 'CHROME_NOT_RUNNING']) {
      await model.loadAndroid();
      expect(model.snapshot().android?.problem?.code).toBe(code);
    }
    expect(model.snapshot().androidReadyOnce).toBe(false);
    await model.openChrome('38041FDJH00ABC');
    expect(frames.at(-1)).toEqual({ op: 'android', launch: '38041FDJH00ABC' });
    expect(model.snapshot().android?.ready).toBe(true);
    expect(model.snapshot().androidReadyOnce).toBe(true);
    expect(start(mockBackend({ instant: true })).snapshot().androidReadyOnce).toBe(true);
  });
});

describe('pairing', () => {
  /** The mock, with a record of what reached the control socket, the Rust side and the tray, and a hand on its links. */
  function pairingBackend(scenario: Scenario) {
    const backend = mockBackend({ instant: true, scenario });
    const frames: Record<string, unknown>[] = [];
    const handed: string[][] = [];
    const announced: [string, string][] = [];
    const trays: TrayStatus[] = [];
    let follow: (act: PairLinkAct) => void = () => undefined;
    let launched: () => void = () => undefined;
    return {
      frames,
      handed,
      announced,
      trays,
      follow: (act: PairLinkAct) => follow(act),
      launch: () => launched(),
      backend: {
        ...backend,
        controlRequest: (frame: Record<string, unknown>, timeoutMs?: number) => (frames.push(frame), backend.controlRequest(frame, timeoutMs)),
        pairRequests: async (requests: PairRequestSummary[]) => void handed.push(requests.map((request) => request.id)),
        announcePaired: async (session: string, name: string) => void announced.push([session, name]),
        trayStatus: async (status: TrayStatus) => void trays.push(status),
        onPairLink: (listener: (act: PairLinkAct) => void) => ((follow = listener), () => undefined),
        onPairingLaunch: (listener: () => void) => ((launched = listener), () => undefined),
      } satisfies MockBackend,
    };
  }

  async function opened(backend: Backend) {
    const model = start(backend);
    await model.runPreflight();
    await until(model, (state) => state.daemon === 'on' && !!state.pairingMode);
    return model;
  }

  it('asks to be the approver on a new socket, and queues the browsers waiting oldest first', async () => {
    const { backend, frames, handed, trays } = pairingBackend('ask');
    const model = await opened(backend);
    await until(model, (state) => state.pairRequests.length === 2);
    expect(frames).toContainEqual({ op: 'pairRequests', watch: true, as: 'app' });
    expect(model.snapshot().pairingMode).toBe('ask');
    expect(model.snapshot().pairRequests.map((request) => request.browser)).toEqual(['Brave', 'Firefox']);
    expect(handed.at(-1)).toEqual(['Rq7bX2kp', 'Fx4mN8cd']);
    await until(model, () => trays.at(-1)?.waiting === 'Brave wants to connect…');
  });

  it('allows the first with the name typed for it, denies the next, and keeps the denied one out', async () => {
    const { backend, frames, handed, trays } = pairingBackend('ask');
    const model = await opened(backend);
    await until(model, (state) => state.pairRequests.length === 2);
    const [brave, firefox] = model.snapshot().pairRequests;

    await model.decide(brave, true, '  Brave (personal) ');
    expect(frames).toContainEqual({ op: 'decide', request: 'Rq7bX2kp', allow: true, label: 'Brave (personal)' });
    expect(model.snapshot().notice?.text).toBe('Brave (personal) can connect to Browsentic Bridge now.');
    expect(model.snapshot().pairRequests.map((request) => request.id)).toEqual(['Fx4mN8cd']);

    await model.decide(firefox, false, 'ignored');
    expect(frames).toContainEqual({ op: 'decide', request: 'Fx4mN8cd', allow: false });
    expect(model.snapshot().notice?.text).toBe('Firefox is kept out. Reconnect it from Browsers if you change your mind.');
    expect(model.snapshot().pairRequests).toEqual([]);
    expect(model.snapshot().blocked).toMatchObject([{ browser: 'Firefox', reason: 'denied' }]);
    expect(handed.at(-1)).toEqual([]);
    await until(model, () => trays.at(-1)?.waiting === null);

    await model.refresh();
    expect(model.snapshot().sessions.find((session) => session.browser === 'Brave' && session.pairedBy === 'approved')?.label).toBe('Brave (personal)');
  });

  it('asks to be the approver again when the Bridge starts the app for a browser', async () => {
    const { backend, frames, launch } = pairingBackend('auto');
    const model = await opened(backend);
    const watching = () => frames.filter((frame) => frame.op === 'pairRequests' && frame.watch === true).length;
    await until(model, () => watching() === 1);
    launch();
    await until(model, () => watching() === 2);
  });

  it('reads the list again when the Bridge says it changed', async () => {
    const { backend } = pairingBackend('auto');
    const model = await opened(backend);
    backend.ask({ id: 'Op9', installId: 'f00dfeed-0000-4000-8000-000000000001', browser: 'Opera', source: 'unpacked', extensionVersion: '0.8.0', firstAt: Date.now(), lastAskAt: Date.now(), nonce: 'n' });
    await until(model, (state) => state.pairRequests[0]?.browser === 'Opera');
  });

  it('changes how browsers pair, and says so through the Bridge', async () => {
    const { backend, frames } = pairingBackend('auto');
    const model = await opened(backend);
    expect(model.pairsByItself).toBe(true);
    await model.setPairingMode('code');
    expect(frames).toContainEqual({ op: 'pairing', set: 'code' });
    expect(model.snapshot().pairingMode).toBe('code');
    expect(model.pairsByItself).toBe(false);
  });

  it('keeps an unpaired browser out, and lets a kept-out one back in with Reconnect', async () => {
    const { backend, frames } = pairingBackend('kept');
    const model = await opened(backend);
    await until(model, (state) => state.blocked.length === 2);
    const vivaldi = model.snapshot().blocked.find((browser) => browser.browser === 'Vivaldi')!;
    await model.reconnect(vivaldi);
    expect(frames).toContainEqual({ op: 'decide', request: vivaldi.installId, allow: true });
    expect(model.snapshot().notice?.text).toBe('Vivaldi can connect again.');
    expect(model.snapshot().blocked.map((browser) => browser.browser)).toEqual(['Opera']);

    await model.revoke(model.snapshot().sessions.find((session) => session.id === 's1'));
    expect(model.snapshot().blocked).toMatchObject([{ browser: 'Opera' }, { browser: 'Google Chrome', reason: 'revoked' }]);
  });

  it('names a browser, and shows the name instead of the browser’s own', async () => {
    const { backend, frames } = pairingBackend('auto');
    const model = await opened(backend);
    await until(model, (state) => state.sessions.length > 0);
    await model.rename(model.snapshot().sessions[0], ' Chrome at home ');
    expect(frames).toContainEqual({ op: 'label', session: 's1', label: 'Chrome at home' });
    expect(model.snapshot().sessions[0].label).toBe('Chrome at home');
  });

  it('announces a browser that paired by itself once, and never the ones it found', async () => {
    const { backend, announced } = pairingBackend('auto');
    const model = await opened(backend);
    await until(model, (state) => state.sessions.length === 2);
    expect(announced).toEqual([]);
    backend.arrive();
    await model.refresh();
    await model.refresh();
    expect(model.snapshot().notice?.text).toBe('Microsoft Edge connected to Browsentic Bridge by itself.');
    expect(announced).toEqual([['6f1c2a90-3b7e-4d1a-9c55-0e8f5d2b7a41', 'Microsoft Edge']]);
  });

  it('acts on a notification’s button only as the Rust side judged it', async () => {
    const { backend, frames, follow } = pairingBackend('ask');
    const model = await opened(backend);
    await until(model, (state) => state.pairRequests.length === 2);

    follow({ kind: 'show', request: 'Rq7bX2kp' });
    follow({ kind: 'decide', request: 'nobody', allow: true });
    expect(frames.filter((frame) => frame.op === 'decide')).toEqual([]);

    follow({ kind: 'decide', request: 'Fx4mN8cd', allow: true });
    await until(model, (state) => state.pairRequests.length === 1);
    expect(frames).toContainEqual({ op: 'decide', request: 'Fx4mN8cd', allow: true });

    follow({ kind: 'browsers' });
    expect(model.snapshot().tab).toBe('browsers');

    follow({ kind: 'unpair', session: 's2' });
    await until(model, (state) => !state.sessions.some((session) => session.id === 's2'));
  });
});
