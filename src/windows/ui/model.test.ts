import { afterEach, describe, expect, it } from 'vitest';

import type { Backend } from './backend';
import { mockBackend } from './mock-backend';
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
      ['edge', 'Edge Add-ons', false],
      ['brave', 'Chrome Web Store', true],
      ['firefox', 'Firefox add-on', false],
    ]);
  });

  it('adds the extension to a browser by opening its store page and handing out the code to enter', async () => {
    const model = await running();
    await until(model, (state) => state.browserRows.length > 0);
    await model.addExtension(model.offeredBrowsers.find((row) => row.id === 'edge')!);
    expect([model.snapshot().pairing?.code, model.snapshot().notice?.text]).toEqual([
      'R4TW7KXE',
      'Press “Get”. Then click Browsentic in Edge’s toolbar and enter the code below.',
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
