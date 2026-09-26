import { browser } from 'wxt/browser';
import { micPermission, watchMicPermission } from '@/lib/bridge/mic-permission';
import { createRecognition, transcriptOf, type SpeechRecognitionLike } from '@/lib/bridge/recognition';
import {
  DICTATION_CHANNEL,
  isDictationCommand,
  type DictationPhase,
  type DictationReport,
} from '@/lib/handsfree/events';

const RESTART_DELAY_MS = 400;

/*
 * The offscreen document hands-free mode listens through. It only exists while the orb should
 * be listening — the background creates it to start and closes it to stop. An `aborted` it did
 * not ask for is therefore another recognizer taking the microphone, since Chrome runs one at a
 * time: it yields rather than taking the mic back.
 *
 * Opened as `dictation.html?hold` it is hold-to-talk instead: it waits, holding no microphone,
 * until told to talk, and when told to stop it lets the recognizer finish the words already
 * spoken rather than cutting them off.
 */
const PHASE_OF_ERROR: Record<string, DictationPhase> = {
  'not-allowed': 'blocked',
  'service-not-allowed': 'blocked',
  'audio-capture': 'no-mic',
  network: 'no-service',
  aborted: 'yielded',
};

const holding = new URLSearchParams(location.search).has('hold');

type Unsent<T> = T extends unknown ? Omit<T, 'channel'> : never;

let speech: SpeechRecognitionLike | null = null;
let wanted = !holding;
let halted = false;
let unsettled = '';

function report(message: Unsent<DictationReport>): void {
  void browser.runtime.sendMessage({ channel: DICTATION_CHANNEL, ...message }).catch(() => undefined);
}

async function granted(): Promise<boolean> {
  const permission = await micPermission();
  if (permission === 'granted') return true;
  report({ op: 'phase', phase: permission === 'prompt' ? 'needs-mic' : 'blocked' });
  return false;
}

async function listen(): Promise<void> {
  if (speech || !wanted || !(await granted())) return;
  const next = createRecognition();
  if (!next) {
    report({ op: 'phase', phase: 'no-service' });
    return;
  }

  halted = false;
  unsettled = '';
  next.onstart = () => report({ op: 'phase', phase: 'listening' });
  next.onresult = (event) => {
    const { interim, final } = transcriptOf(event);
    unsettled = interim;
    if (interim) report({ op: 'heard', text: interim, final: false });
    if (final) report({ op: 'heard', text: final, final: true });
  };
  next.onerror = (event) => {
    if (event.error === 'no-speech') return;
    halted = true;
    report({ op: 'phase', phase: PHASE_OF_ERROR[event.error] ?? 'no-service' });
  };
  next.onend = () => {
    speech = null;
    if (unsettled && !wanted) report({ op: 'heard', text: unsettled, final: true });
    unsettled = '';
    if (halted) return;
    if (wanted) setTimeout(() => void listen(), RESTART_DELAY_MS);
    else report({ op: 'phase', phase: 'held' });
  };

  speech = next;
  report({ op: 'phase', phase: 'starting' });
  try {
    next.start();
  } catch {
    speech = null;
    report({ op: 'phase', phase: 'no-service' });
  }
}

async function wait(): Promise<void> {
  if (await granted()) report({ op: 'phase', phase: 'held' });
}

function talk(on: boolean): void {
  wanted = on;
  if (on) {
    void listen();
    return;
  }
  if (speech) speech.stop();
  else void wait();
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (holding && isDictationCommand(message)) talk(message.on);
});

watchMicPermission((state) => {
  if (state === 'denied') report({ op: 'phase', phase: 'blocked' });
  else if (state === 'granted') void (wanted ? listen() : wait());
});

void (holding ? wait() : listen());
