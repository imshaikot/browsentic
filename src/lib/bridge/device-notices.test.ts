import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { DeviceNotice } from '@/lib/notices';

const socket = vi.hoisted(() => ({ sendNotice: vi.fn(), opened: null as ((noticeId: string) => void) | null }));
const toast = vi.hoisted(() => ({ goToTab: vi.fn() }));

vi.mock('./socket', () => ({
  sendNotice: socket.sendNotice,
  onOpenNotice: (listener: (noticeId: string) => void) => {
    socket.opened = listener;
    return () => undefined;
  },
}));
vi.mock('./toast', () => ({ goToTab: toast.goToTab }));

const { browserInFront, noticeOnDevice, serveDeviceNotices } = await import('./device-notices');

const done: DeviceNotice = { id: 'monitor:build', kind: 'monitor', title: 'Done: build', body: 'Finished after 3:12.', tone: 'live' };

type Window = { id: number; focused: boolean; state: string };

function windows(list: Window[]): void {
  (fakeBrowser.windows as unknown as { getAll: () => Promise<Window[]> }).getAll = async () => list;
  (fakeBrowser.windows as unknown as { update: (id: number, change: object) => Promise<object> }).update = vi.fn(async () => ({}));
}

beforeEach(() => {
  fakeBrowser.reset();
  socket.sendNotice.mockReset();
  toast.goToTab.mockReset();
});

describe('browserInFront', () => {
  it('is true only while some window is focused and not minimized', async () => {
    windows([{ id: 1, focused: true, state: 'normal' }]);
    expect(await browserInFront()).toBe(true);
    windows([{ id: 1, focused: false, state: 'normal' }]);
    expect(await browserInFront()).toBe(false);
    windows([{ id: 1, focused: true, state: 'minimized' }]);
    expect(await browserInFront()).toBe(false);
    windows([]);
    expect(await browserInFront()).toBe(false);
  });
});

describe('noticeOnDevice', () => {
  it('leaves the notice to the page while someone is looking at the browser', async () => {
    windows([{ id: 1, focused: true, state: 'maximized' }]);
    expect(await noticeOnDevice(done, 7)).toBe(false);
    expect(socket.sendNotice).not.toHaveBeenCalled();
  });

  it('hands it to the app while the browser is behind, and falls back when the app will not take it', async () => {
    windows([{ id: 1, focused: false, state: 'normal' }]);
    socket.sendNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await noticeOnDevice(done, 7)).toBe(true);
    expect(await noticeOnDevice({ ...done, id: 'monitor:other' }, 8)).toBe(false);
  });

  it('brings the notice’s own tab forward when it is clicked, or a window when it had none', async () => {
    windows([{ id: 4, focused: false, state: 'minimized' }]);
    serveDeviceNotices();
    socket.sendNotice.mockResolvedValue(true);
    await noticeOnDevice(done, 7);
    await noticeOnDevice({ ...done, id: 'task:t1' });

    socket.opened!(done.id);
    await vi.waitFor(() => expect(toast.goToTab).toHaveBeenCalledWith(7));
    socket.opened!('task:t1');
    await vi.waitFor(() => expect(fakeBrowser.windows.update).toHaveBeenCalledWith(4, { focused: true }));
  });
});
