import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { ACTION_CHANNEL, success } from '@/lib/actions/protocol';
import { CUE_CHANNEL } from '@/lib/cues/events';
import { cueFor } from '@/lib/cues/plan';
import { BLOCKED_SITES_KEY } from '@/lib/settings/blocked-sites';
import { ACTION_CUES_KEY, CUE_LEAD_MS, cued, quenchCues } from './action-cues';
import { forgetFrameFocus, setFramePath } from './frame-focus';
import { invokeForHarness } from './invoke';

type Sent = { tabId: number; frameId?: number; message: { channel: string; op?: string; action?: string } & Record<string, unknown> };

let sent: Sent[];
let answer: (message: Sent['message']) => unknown;

const cues = () => sent.filter((entry) => entry.message.channel === CUE_CHANNEL);
const ops = () => sent.map((entry) => (entry.message.channel === CUE_CHANNEL ? `cue:${entry.message.op}` : `action:${entry.message.action}`));
const tabOn = async (url: string) => (await fakeBrowser.tabs.create({ url, active: true })).id!;

beforeEach(async () => {
  fakeBrowser.reset();
  sent = [];
  answer = (message) => (message.channel === ACTION_CHANNEL ? success({ done: true }) : { ok: true });
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation((async (tabId: number, message: Sent['message'], options?: { frameId?: number }) => {
    sent.push({ tabId, frameId: options?.frameId, message });
    return answer(message);
  }) as never);
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ content_scripts: [] } as never);
  await fakeBrowser.storage.local.set({ [ACTION_CUES_KEY]: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cued', () => {
  it('draws nothing until the user switches cues on', async () => {
    await fakeBrowser.storage.local.remove(ACTION_CUES_KEY);
    const tabId = await tabOn('https://example.com/');
    await invokeForHarness('page.clickElement', { target: { selector: '#go' } }, tabId);
    expect(ops()).toEqual(['action:page.clickElement']);
  });

  it('rings the element before the action runs and settles it after', async () => {
    const tabId = await tabOn('https://example.com/');
    const result = await invokeForHarness('page.clickElement', { target: { selector: '#go' } }, tabId);

    expect(result.ok).toBe(true);
    expect(ops()).toEqual(['cue:show', 'action:page.clickElement', 'cue:settle']);
    const [show, settle] = cues();
    expect(show.message).toMatchObject({ plan: { kind: 'element', verb: 'Click' }, theme: 'ember' });
    expect(settle.message).toMatchObject({ id: show.message.id, ok: true });
  });

  it('settles a failed action as failed', async () => {
    const tabId = await tabOn('https://example.com/');
    answer = (message) =>
      message.channel === ACTION_CHANNEL ? { ok: false, error: { code: 'TARGET_NOT_FOUND', message: 'none' } } : { ok: true };
    await invokeForHarness('page.clickElement', { target: { selector: '#go' } }, tabId);
    expect(cues().at(-1)?.message).toMatchObject({ op: 'settle', ok: false });
  });

  it('never carries what the agent types', async () => {
    const tabId = await tabOn('https://example.com/');
    await invokeForHarness('page.fillInput', { target: { selector: '#pw' }, value: 'hunter2' }, tabId);
    expect(cues()).toHaveLength(2);
    expect(JSON.stringify(cues())).not.toContain('hunter2');
  });

  it('draws nothing on a blocked site', async () => {
    await fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: ['mybank.com'] });
    const tabId = await tabOn('https://mybank.com/');
    const result = await invokeForHarness('page.clickElement', { target: { selector: '#go' } }, tabId);
    expect(result.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('draws nothing once the user has switched cues off', async () => {
    await fakeBrowser.storage.local.set({ [ACTION_CUES_KEY]: false });
    const tabId = await tabOn('https://example.com/');
    await invokeForHarness('page.clickElement', { target: { selector: '#go' } }, tabId);
    expect(ops()).toEqual(['action:page.clickElement']);
  });

  it('sends a page cue to the top frame and an element cue to the frame the agent is in', async () => {
    await setFramePath(500, [{ frameId: 3, url: 'https://ads.example/', selector: 'iframe' }]);
    await cued(500, cueFor('page.getPageInfo', {}), async () => success(null));
    await cued(500, cueFor('page.clickElement', { target: { selector: '#go' } }), async () => success(null));
    await forgetFrameFocus(500);
    expect(cues().map((entry) => [entry.message.op, entry.frameId])).toEqual([
      ['show', 0],
      ['settle', 0],
      ['show', 3],
      ['settle', 3],
    ]);
  });

  it('never holds an action up longer than the lead for a tab that does not answer', async () => {
    vi.useFakeTimers();
    answer = () => new Promise(() => undefined);
    const perform = vi.fn(async () => success(null));
    const running = cued(9, cueFor('page.clickElement', { target: { selector: '#go' } }), perform);
    await vi.advanceTimersByTimeAsync(CUE_LEAD_MS - 1);
    expect(perform).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(perform).toHaveBeenCalledOnce();
    await running;
  });

  it('clears a lingering ring before a capture, and asks nothing of a tab with none', async () => {
    await cued(4, cueFor('page.clickElement', { target: { selector: '#go' } }), async () => success(null));
    sent = [];
    await cued(4, cueFor('page.screenshot', {}), async () => success(null));
    expect(ops()).toEqual(['cue:quench']);

    sent = [];
    await quenchCues(4);
    await quenchCues(12);
    expect(sent).toEqual([]);
  });
});
