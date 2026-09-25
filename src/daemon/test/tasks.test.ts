import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SocketFrame } from '@/lib/actions/protocol';
import type { TaskList } from '@/lib/schedules/task';
import { clearAuth } from '../auth-store';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { schedulesPath } from '../schedules/store';
import { FakeBrowser, type Profile } from './fake-browser';

const chrome: Profile = { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', installId: 'install-chrome-0001', browser: 'Google Chrome' };

let daemon: Daemon;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
});

afterAll(async () => {
  await daemon?.stop();
});

beforeEach(() => rmSync(schedulesPath, { force: true }));

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
});

async function paired(): Promise<FakeBrowser> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  opened.push(bridge);
  const browser = await FakeBrowser.connect(daemon.port, chrome, { kind: 'pair', code: (await bridge.pair()).code });
  opened.push(browser);
  return browser;
}

function listOf(frame: SocketFrame): TaskList {
  if (frame.t !== 'taskList' || !frame.result.ok) throw new Error(`expected a task list, got ${JSON.stringify(frame)}`);
  return frame.result.data;
}

const draft = {
  name: 'PR digest',
  job: { kind: 'instruction', text: 'Summarise the PRs waiting on my review.' },
  url: 'https://github.com/pulls',
  rule: { kind: 'weekly', days: [1, 2, 3, 4, 5], times: ['09:00'] },
};

describe('scheduled tasks between the daemon and a browser', () => {
  test('a saved task runs in the browser that asked, and its result comes back into the log', async () => {
    const browser = await paired();
    const saved = listOf(await browser.ask({ t: 'saveTask', id: randomUUID(), task: draft }));
    const [task] = saved.tasks;
    expect(task).toMatchObject({ name: 'PR digest', enabled: true, runCount: 0 });

    const started = listOf(await browser.ask({ t: 'runTaskNow', id: randomUUID(), taskId: task.id }));
    expect(Object.keys(started.running)).toEqual([task.id]);
    await vi.waitFor(() => expect(browser.orders).toHaveLength(1));
    expect(browser.orders[0]).toMatchObject({ id: task.id, url: draft.url, job: draft.job });

    browser.tell({ t: 'taskDone', id: randomUUID(), taskId: task.id, result: { outcome: 'ok', headline: '3 PRs need you', durationMs: 900 } });

    await vi.waitFor(() => expect(browser.tasks?.tasks[0].runs[0]).toMatchObject({ outcome: 'ok', headline: '3 PRs need you' }));
    expect(browser.tasks?.running).toEqual({});
  });

  test('a browser is handed the list the moment it connects', async () => {
    const first = await paired();
    await first.ask({ t: 'saveTask', id: randomUUID(), task: draft });
    first.close();

    const second = await paired();
    await vi.waitFor(() => expect(second.tasks?.tasks.map((task) => task.name)).toEqual(['PR digest']));
  });

  test('a run the browser refuses is logged with the reason', async () => {
    const browser = await paired();
    browser.taskReply = { ok: false, error: { code: 'SESSION_LIMIT', message: '8 tab sessions are already open.' } };
    const [task] = listOf(await browser.ask({ t: 'saveTask', id: randomUUID(), task: draft })).tasks;

    await browser.ask({ t: 'runTaskNow', id: randomUUID(), taskId: task.id });

    await vi.waitFor(() => expect(browser.tasks?.tasks[0].runs[0]).toMatchObject({ outcome: 'failed', reason: 'SESSION_LIMIT: 8 tab sessions are already open.' }));
  });

  test('a browser that disconnects mid-run leaves a failed run behind', async () => {
    const browser = await paired();
    const [task] = listOf(await browser.ask({ t: 'saveTask', id: randomUUID(), task: draft })).tasks;
    await browser.ask({ t: 'runTaskNow', id: randomUUID(), taskId: task.id });
    await vi.waitFor(() => expect(browser.orders).toHaveLength(1));

    browser.close();
    await browser.closed;

    const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
    opened.push(bridge);
    const watcher = await FakeBrowser.connect(daemon.port, chrome, { kind: 'pair', code: (await bridge.pair()).code });
    opened.push(watcher);
    await vi.waitFor(() =>
      expect(watcher.tasks?.tasks[0].runs[0]).toMatchObject({ outcome: 'failed', reason: 'The browser disconnected before the run finished.' }),
    );
  });

  test('pausing everything and deleting a task are answered with the new list', async () => {
    const browser = await paired();
    const [task] = listOf(await browser.ask({ t: 'saveTask', id: randomUUID(), task: draft })).tasks;

    expect(listOf(await browser.ask({ t: 'pauseTasks', id: randomUUID(), paused: true })).paused).toBe(true);
    expect(listOf(await browser.ask({ t: 'deleteTask', id: randomUUID(), taskId: task.id })).tasks).toEqual([]);
    expect(await browser.ask({ t: 'deleteTask', id: randomUUID(), taskId: task.id })).toMatchObject({
      t: 'taskList',
      result: { ok: false, error: { code: 'TASK_NOT_FOUND' } },
    });
  });
});
