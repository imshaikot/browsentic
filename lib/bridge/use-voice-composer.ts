import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeech } from './use-speech';

/** Silence gap after a finalized phrase before it auto-sends. Long enough to keep talking. */
const AUTO_SEND_MS = 1600;

export interface VoiceComposer {
  /** The editable buffer — dictation lands here, and typing is the fallback into the same box. */
  input: string;
  setInput: (value: string) => void;
  /** The live, not-yet-final transcript, for a "…" preview while the speaker is mid-sentence. */
  interim: string;
  listening: boolean;
  supported: boolean;
  error: string | null;
  /** A phrase is captured and will auto-send unless the speaker keeps going or intervenes. */
  pendingSend: boolean;
  /** Milliseconds the auto-send waits, so the UI can size a matching countdown. */
  autoSendMs: number;
  /** Stop the pending auto-send but keep the text (the user wants to edit it). */
  cancelPending: () => void;
  /** Send the buffer right now (Enter, the send button, or the countdown firing). */
  submitNow: () => void;
  /** Re-attempt listening after a mic-permission error, this time behind a user gesture. */
  retry: () => void;
}

/**
 * Hands-free dictation over {@link useSpeech}: finalized phrases append to an editable buffer
 * and auto-send after a brief silence, so speaking a sentence and pausing dispatches it. Any
 * of — more speech, typing, or an explicit cancel — calls off that pending send, so the user
 * is never fighting the timer. `active` gates listening; the caller lowers it during a run and
 * while disconnected so the mic is not capturing when nothing can act on it.
 */
export function useVoiceComposer(opts: {
  active: boolean;
  onSubmit: (text: string) => void;
  autoSendMs?: number;
}): VoiceComposer {
  const autoSendMs = opts.autoSendMs ?? AUTO_SEND_MS;
  const [input, setInputState] = useState('');
  const [interim, setInterim] = useState('');
  const [pendingSend, setPendingSend] = useState(false);
  const inputRef = useRef('');
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = useRef(opts.onSubmit);
  submit.current = opts.onSubmit;

  const setInput = useCallback((value: string) => {
    inputRef.current = value;
    setInputState(value);
  }, []);

  const cancelPending = useCallback(() => {
    if (sendTimer.current) {
      clearTimeout(sendTimer.current);
      sendTimer.current = null;
    }
    setPendingSend(false);
  }, []);

  const submitNow = useCallback(() => {
    cancelPending();
    const text = inputRef.current.trim();
    if (!text) return;
    setInput('');
    setInterim('');
    submit.current(text);
  }, [cancelPending, setInput]);

  const scheduleSend = useCallback(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    setPendingSend(true);
    sendTimer.current = setTimeout(() => {
      sendTimer.current = null;
      setPendingSend(false);
      submitNow();
    }, autoSendMs);
  }, [autoSendMs, submitNow]);

  const speech = useSpeech({
    onInterim: (text) => {
      setInterim(text);
      cancelPending(); // still talking — don't fire the pending send
    },
    onFinal: (text) => {
      setInterim('');
      setInput(inputRef.current ? `${inputRef.current} ${text}` : text);
      scheduleSend();
    },
  });

  // Listen exactly while the caller wants it. Callbacks from useSpeech are stable, so this
  // effect only re-runs when `active` flips.
  const { start, stop } = speech;
  useEffect(() => {
    if (opts.active) start();
    else {
      stop();
      cancelPending();
    }
  }, [opts.active, start, stop, cancelPending]);

  // Typing takes over from the timer — the user is editing, not dictating.
  const setInputManual = useCallback(
    (value: string) => {
      setInput(value);
      cancelPending();
    },
    [setInput, cancelPending],
  );

  return {
    input,
    setInput: setInputManual,
    interim,
    listening: speech.listening,
    supported: speech.supported,
    error: speech.error,
    pendingSend,
    autoSendMs,
    cancelPending,
    submitNow,
    retry: start,
  };
}
