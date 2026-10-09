import { success, type ActionResult } from '@/lib/actions/protocol';
import type { AndroidState } from '@/lib/phone/types';
import type { Android } from '../android/service';

export const NO_PHONE: AndroidState = {
  enabled: true,
  ready: false,
  adb: { found: true, path: '/fake/adb', version: '1.0.41' },
  devices: [],
  problem: { code: 'NO_DEVICE', message: 'No phone is connected.' },
};

export const READY_PHONE: AndroidState = {
  enabled: true,
  ready: true,
  adb: { found: true, path: '/fake/adb', version: '1.0.41' },
  devices: [
    {
      serial: 'emulator-5554',
      transport: 'usb',
      state: 'ready',
      model: 'Pixel Fold',
      chrome: { installed: true, version: '150.0.7871.186', running: true, debuggable: true },
    },
  ],
};

/** The Bridge's view of the phones, set by the test instead of read from adb. */
export class FakeAndroid implements Android {
  current: AndroidState = NO_PHONE;
  readonly launched: string[] = [];
  private readonly listeners = new Set<(state: AndroidState) => void>();

  get watchers(): number {
    return this.listeners.size;
  }

  async state(): Promise<AndroidState> {
    return this.current;
  }

  watch(listener: (state: AndroidState) => void): () => void {
    this.listeners.add(listener);
    queueMicrotask(() => this.listeners.has(listener) && listener(this.current));
    return () => this.listeners.delete(listener);
  }

  async launch(serial: string): Promise<ActionResult<AndroidState>> {
    this.launched.push(serial);
    return success(this.current);
  }

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  change(next: AndroidState): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}
