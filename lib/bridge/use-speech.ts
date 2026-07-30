import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

interface SpeechAlternativeLike {
  readonly transcript: string;
}
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike;
}
interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike;
}
interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}
interface SpeechErrorEventLike {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const RESTART_DELAY_MS = 400;

const MIC_BLOCKED = 'Microphone access is blocked. Allow it for this extension, or type instead.';

export const VOICE_PREF_KEY = 'voicelink:voiceEnabled';

export function useVoiceEnabled(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(VOICE_PREF_KEY).then((stored) => {
      if (live && typeof stored[VOICE_PREF_KEY] === 'boolean') setEnabled(stored[VOICE_PREF_KEY] as boolean);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (VOICE_PREF_KEY in changes && typeof changes[VOICE_PREF_KEY].newValue === 'boolean') {
        setEnabled(changes[VOICE_PREF_KEY].newValue as boolean);
      }
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  const set = useCallback((on: boolean) => {
    setEnabled(on);
    void browser.storage.local.set({ [VOICE_PREF_KEY]: on });
  }, []);

  return [enabled, set];
}

export interface UseSpeechOptions {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
}

export interface Speech {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useSpeech({ onFinal, onInterim }: UseSpeechOptions): Speech {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = useMemo(() => recognitionCtor() !== null, []);

  const handlers = useRef({ onFinal, onInterim });
  handlers.current = { onFinal, onInterim };

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micGrant = useRef<Promise<void> | null>(null);
  const beginRef = useRef<() => void>(() => {});

  const ensureMic = useCallback(() => {
    if (!micGrant.current) {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        micGrant.current = Promise.resolve();
      } else {
        micGrant.current = media
          .getUserMedia({ audio: true })
          .then((stream) => stream.getTracks().forEach((track) => track.stop()))
          .catch((cause) => {
            micGrant.current = null;
            throw cause;
          });
      }
    }
    return micGrant.current;
  }, []);

  const begin = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    try {
      await ensureMic();
    } catch {
      wanted.current = false;
      setListening(false);
      setError(MIC_BLOCKED);
      return;
    }
    if (!wanted.current) return;

    const speech = new Ctor();
    speech.continuous = true;
    speech.interimResults = true;
    speech.lang = navigator.language || 'en-US';
    speech.maxAlternatives = 1;

    speech.onstart = () => {
      setListening(true);
      setError(null);
    };
    speech.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (interim.trim()) handlers.current.onInterim?.(interim.trim());
      if (final.trim()) handlers.current.onFinal(final.trim());
    };
    speech.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wanted.current = false;
        micGrant.current = null;
        setError(MIC_BLOCKED);
        return;
      }
      if (event.error === 'audio-capture') {
        wanted.current = false;
        setError('No microphone was found.');
        return;
      }
      setError(event.error);
    };
    speech.onend = () => {
      recognition.current = null;
      setListening(false);
      if (!wanted.current) return;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(() => {
        if (wanted.current) beginRef.current();
      }, RESTART_DELAY_MS);
    };

    recognition.current = speech;
    try {
      speech.start();
    } catch {
    }
  }, [ensureMic]);

  beginRef.current = () => void begin();

  const start = useCallback(() => {
    if (!recognitionCtor()) return;
    wanted.current = true;
    void begin();
  }, [begin]);

  const stop = useCallback(() => {
    wanted.current = false;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    const speech = recognition.current;
    recognition.current = null;
    setListening(false);
    if (speech) {
      try {
        speech.abort();
      } catch {
      }
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, error, start, stop };
}
