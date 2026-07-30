import { browser } from 'wxt/browser';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { startCapture } from './capture';
import type { RecordedEvent } from './events';

export const RECORD_CHANNEL = 'voicelink/record';

interface RecordCommand {
  channel: typeof RECORD_CHANNEL;
  op: 'begin' | 'end';
}

export function exposeRecorder(): void {
  let stop: (() => void) | null = null;

  const begin = (captureValues: boolean) => {
    if (stop) return;
    stop = startCapture({
      captureValues,
      send: (events: RecordedEvent[]) => {
        void browser.runtime
          .sendMessage({ channel: BRIDGE_CHANNEL, op: 'recordEvents', events })
          .catch(() => undefined);
      },
    });
  };

  const end = () => {
    stop?.();
    stop = null;
  };

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRecordCommand(message)) return;
    if (message.op === 'begin') void armed().then((state) => state.recording && begin(state.captureValues));
    else end();
  });

  void armed().then((state) => {
    if (state.recording) begin(state.captureValues);
  });
}

async function armed(): Promise<{ recording: boolean; captureValues: boolean }> {
  try {
    const state = await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'recordingState' });
    const data = (state as { ok?: boolean; data?: { recording?: boolean; captureValues?: boolean } })?.data;
    return { recording: data?.recording === true, captureValues: data?.captureValues === true };
  } catch {
    return { recording: false, captureValues: false };
  }
}

function isRecordCommand(message: unknown): message is RecordCommand {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as RecordCommand).channel === RECORD_CHANNEL
  );
}
