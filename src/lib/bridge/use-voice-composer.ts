import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeech } from './use-speech';

const AUTO_SEND_MS = 1600;

export interface VoiceComposer {
  input: string;
  setInput: (value: string) => void;
  interim: string;
  listening: boolean;
  supported: boolean;
  error: string | null;
  pendingSend: boolean;
  autoSendMs: number;
  cancelPending: () => void;
  submitNow: () => void;
  retry: () => void;
}

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
      cancelPending();
    },
    onFinal: (text) => {
      setInterim('');
      setInput(inputRef.current ? `${inputRef.current} ${text}` : text);
      scheduleSend();
    },
  });

  const { start, stop } = speech;
  useEffect(() => {
    if (opts.active) start();
    else {
      stop();
      cancelPending();
    }
  }, [opts.active, start, stop, cancelPending]);

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
