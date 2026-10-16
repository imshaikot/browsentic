import { describe, expect, it, vi } from 'vitest';
import type { DeviceNotice } from '@/lib/notices';
import { noticeDesk } from './notice-desk';

const done: DeviceNotice = { id: 'monitor:m1', kind: 'monitor', title: 'Done: build', body: 'Finished after 3:12.', tone: 'live' };
const from = { id: 'install-notice-chrome', browser: 'Google Chrome' };

function desk() {
  let clock = 1_000_000;
  const changed = vi.fn();
  return { desk: noticeDesk({ changed, now: () => clock }), changed, advance: (ms: number) => (clock += ms) };
}

describe('the notice desk', () => {
  it('takes nothing while no app may show it, so the browser shows its own card', () => {
    const { desk: built, changed } = desk();
    expect(built.offer(done, from)).toBe(false);

    built.watch({}, false);
    expect(built.offer(done, from)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('queues a notice for an app that may show it, says so, and hands it over once', () => {
    const { desk: built, changed } = desk();
    built.watch({}, true);

    expect(built.offer(done, from)).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(built.take()).toEqual([{ ...done, browser: 'Google Chrome', at: 1_000_000 }]);
    expect(built.take()).toEqual([]);
  });

  it('replaces a repeat of the same notice rather than stacking it', () => {
    const { desk: built } = desk();
    built.watch({}, true);
    built.offer(done, from);
    built.offer({ ...done, body: 'Finished after 3:13.' }, from);
    expect(built.take().map((notice) => notice.body)).toEqual(['Finished after 3:13.']);
  });

  it('drops a notice nobody took within five minutes', () => {
    const { desk: built, advance } = desk();
    built.watch({}, true);
    built.offer(done, from);
    advance(5 * 60_000);
    expect(built.take()).toEqual([]);
  });

  it('remembers which browser a notice came from after it was taken, for a click', () => {
    const { desk: built } = desk();
    built.watch({}, true);
    built.offer(done, from);
    built.take();
    expect(built.routeOf(done.id)).toBe(from.id);
    expect(built.routeOf('monitor:other')).toBeUndefined();
  });

  it('stops counting an app once it goes, or once notifications are turned off', () => {
    const { desk: built } = desk();
    const app = {};
    built.watch(app, true);
    expect(built.canShow()).toBe(true);
    built.watch(app, false);
    expect(built.canShow()).toBe(false);
    built.watch(app, true);
    built.unwatch(app);
    expect(built.canShow()).toBe(false);
  });
});
