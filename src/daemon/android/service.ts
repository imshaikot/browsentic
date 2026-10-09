import { failure, type ActionResult } from '@/lib/actions/protocol';
import type { AndroidProblem, AndroidState } from '@/lib/phone/types';

export interface Android {
  state(): Promise<AndroidState>;
  /**
   * A watcher hears the state as soon as it is known, then every change. The Bridge looks for phones
   * only while someone holds a watch, and the returned function lets go of it.
   */
  watch(listener: (state: AndroidState) => void): () => void;
  launch(serial: string, url?: string): Promise<ActionResult<AndroidState>>;
  stop(): Promise<void>;
}

const SWITCHED_OFF: AndroidProblem = {
  code: 'ANDROID_OFF',
  message: 'Android is switched off for this computer.',
  fix: 'Set "android": { "enabled": true } in ~/.browsentic/config.json',
};

export const ANDROID_OFF_STATE: AndroidState = {
  enabled: false,
  ready: false,
  adb: { found: false },
  devices: [],
  problem: SWITCHED_OFF,
};

export function androidOff(): Android {
  return {
    state: async () => ANDROID_OFF_STATE,
    watch: (listener) => {
      queueMicrotask(() => listener(ANDROID_OFF_STATE));
      return () => {};
    },
    launch: async () => failure(SWITCHED_OFF.code, SWITCHED_OFF.message),
    stop: async () => {},
  };
}
