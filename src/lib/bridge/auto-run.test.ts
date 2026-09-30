import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing';
import { autoRunSource, QUIET_MS, SETTLE_CAP_MS, syncAutoRuns } from './auto-run';
import { saveTool, scopeMatches, type SavedTool } from './saved-tools';

type UserScript = Browser.userScripts.RegisteredUserScript;

const MARK = 'tools.mark = () => { window.marks.push(location.href); };';

function tool(overrides: Partial<SavedTool> = {}): SavedTool {
  return {
    id: 't1',
    name: 'youtube.com:watch:mark-visit',
    skillName: 'tool-youtube-com-watch-mark-visit',
    description: 'Mark the visit',
    scope: { host: 'youtube.com', segment: 'watch' },
    origin: 'https://www.youtube.com',
    code: MARK,
    fn: 'mark',
    autoRun: true,
    createdAt: 0,
    ...overrides,
  };
}

interface FakePage {
  marks: string[];
  warnings: unknown[][];
  go: (url: string) => void;
  mutate: () => void;
  load: () => void;
}

function openPage(url: string, saved: SavedTool = tool(), readyState = 'complete'): FakePage {
  const location = new URL(url);
  const document = { readyState, documentElement: {} };
  const marks: string[] = [];
  const warnings: unknown[][] = [];
  const entryListeners: Array<() => void> = [];
  const loadListeners: Array<() => void> = [];
  const observers = new Set<() => void>();

  const window = {
    marks,
    navigation: { addEventListener: (_type: string, listener: () => void) => entryListeners.push(listener) },
    addEventListener: (_type: string, listener: () => void) => loadListeners.push(listener),
  };
  class Observer {
    constructor(private readonly callback: () => void) {}
    observe() {
      observers.add(this.callback);
    }
    disconnect() {
      observers.delete(this.callback);
    }
  }
  const console = { warn: (...args: unknown[]) => warnings.push(args) };

  new Function('location', 'document', 'window', 'MutationObserver', 'console', autoRunSource(saved))(
    location,
    document,
    window,
    Observer,
    console,
  );

  return {
    marks,
    warnings,
    go: (next) => {
      location.href = next;
      for (const listener of entryListeners) listener();
    },
    mutate: () => {
      for (const observer of [...observers]) observer();
    },
    load: () => {
      document.readyState = 'complete';
      for (const listener of loadListeners) listener();
    },
  };
}

describe('the script Chrome injects', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('runs the entry point once the page goes quiet', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a');
    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(page.marks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.marks).toEqual(['https://www.youtube.com/watch?v=a']);
  });

  test('a page that never stops changing still gets it, at the cap', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a');
    for (let elapsed = 0; elapsed < SETTLE_CAP_MS - 100; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      page.mutate();
    }
    expect(page.marks).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(page.marks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS);
    expect(page.marks).toHaveLength(1);
  });

  test('waits for the load event', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a', tool(), 'interactive');
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS * 2);
    expect(page.marks).toEqual([]);
    page.load();
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.marks).toHaveLength(1);
  });

  test('stays out of another part of the same site', async () => {
    const page = openPage('https://www.youtube.com/results?q=cats');
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS);
    expect(page.marks).toEqual([]);
  });

  test('a single-page site runs it on each arrival, not on every move within', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    page.go('https://www.youtube.com/watch?v=b');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.marks).toEqual(['https://www.youtube.com/watch?v=a']);

    page.go('https://www.youtube.com/results?q=cats');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    page.go('https://www.youtube.com/watch?v=c');
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.marks).toEqual(['https://www.youtube.com/watch?v=a', 'https://www.youtube.com/watch?v=c']);
  });

  test('leaving before the page settles cancels that run', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a');
    page.go('https://www.youtube.com/results?q=cats');
    await vi.advanceTimersByTimeAsync(SETTLE_CAP_MS);
    expect(page.marks).toEqual([]);
  });

  test('a tool that throws is reported, not raised into the page', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a', tool({ code: 'tools.mark = () => { throw new Error("gone"); };' }));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.warnings).toHaveLength(1);
    expect(String(page.warnings[0][1])).toContain('gone');
  });

  test('code that fails while defining its tools is reported the same way', async () => {
    const page = openPage('https://www.youtube.com/watch?v=a', tool({ code: 'missing.thing = 1;' }));
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.warnings).toHaveLength(1);
  });

  const watch = tool();
  const root = tool({ scope: { host: 'example.com', segment: 'root' }, origin: 'https://example.com' });
  test.each([
    [watch, 'https://www.youtube.com/watch?v=a'],
    [watch, 'https://www.youtube.com/Watch'],
    [watch, 'https://www.youtube.com/watch/live'],
    [watch, 'https://www.youtube.com/watchlater'],
    [watch, 'https://www.youtube.com/'],
    [watch, 'https://youtube.com/watch?v=a'],
    [watch, 'http://www.youtube.com/watch?v=a'],
    [watch, 'https://www.youtube.com:8443/watch?v=a'],
    [watch, 'https://music.youtube.com/watch?v=a'],
    [root, 'https://example.com/'],
    [root, 'https://example.com/?q=1'],
    [root, 'https://example.com/about'],
  ])('decides %# the way `/` does', async (saved, url) => {
    const page = openPage(url, saved);
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(page.marks.length > 0).toBe(scopeMatches(saved, url));
  });
});

function stubUserScripts(registered: UserScript[] = []) {
  const scripts = new Map(registered.map((script) => [script.id, script]));
  const api = {
    getScripts: vi.fn(async () => [...scripts.values()]),
    register: vi.fn(async (list: UserScript[]) => {
      for (const script of list) scripts.set(script.id, script);
    }),
    unregister: vi.fn(async ({ ids }: { ids: string[] }) => {
      for (const id of ids) scripts.delete(id);
    }),
  };
  Object.assign(fakeBrowser, { userScripts: api });
  return { api, scripts };
}

describe('keeping Chrome in step with the saved list', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // WXT's test plugin passes build flags as strings, and "false" is truthy.
    vi.stubEnv('FIREFOX', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  test('registers each tool set to run on every visit, in the page’s world, on its host', async () => {
    const { scripts } = stubUserScripts();
    await saveTool(tool());
    await saveTool(tool({ id: 't2', name: 'youtube.com:watch:other', autoRun: false }));
    await syncAutoRuns();

    expect([...scripts.keys()]).toEqual(['browsentic-tool-t1']);
    expect(scripts.get('browsentic-tool-t1')).toMatchObject({
      matches: ['https://www.youtube.com/*'],
      world: 'MAIN',
      runAt: 'document_idle',
    });
  });

  test('takes a script back out once its tool stops asking for it', async () => {
    const { scripts } = stubUserScripts();
    await saveTool(tool());
    await syncAutoRuns();
    await saveTool(tool({ autoRun: false }));
    await syncAutoRuns();
    expect(scripts.size).toBe(0);
  });

  test('replaces a script whose code changed, and leaves an unchanged one alone', async () => {
    const { api, scripts } = stubUserScripts();
    await saveTool(tool());
    await syncAutoRuns();
    await syncAutoRuns();
    expect(api.register).toHaveBeenCalledTimes(1);

    await saveTool(tool({ code: 'tools.mark = () => 2;' }));
    await syncAutoRuns();
    expect(api.register).toHaveBeenCalledTimes(2);
    expect(scripts.get('browsentic-tool-t1')?.js?.[0]?.code).toContain('tools.mark = () => 2;');
  });

  test('leaves scripts it did not register alone', async () => {
    const { scripts } = stubUserScripts([{ id: 'someone-else', matches: ['https://a.test/*'], js: [{ code: '' }] }]);
    await syncAutoRuns();
    expect([...scripts.keys()]).toEqual(['someone-else']);
  });

  test('waits quietly while Chrome does not allow user scripts', async () => {
    const register = vi.fn();
    Object.assign(fakeBrowser, {
      userScripts: {
        getScripts: () => {
          throw new Error('The userScripts API is only available once Allow User Scripts is on.');
        },
        register,
      },
    });
    await saveTool(tool());
    await expect(syncAutoRuns()).resolves.toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });
});
