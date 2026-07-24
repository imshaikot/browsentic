import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * The browser's Web Speech API, typed just enough for what we use. `webkitSpeechRecognition`
 * is not in lib.dom, and Chrome streams the audio to Google to transcribe — that is the whole
 * dependency, no bundled model. Feature-detect and fall back to typing when it is absent.
 */
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

/** Chrome ends recognition after a stretch of silence; restart this soon after to stay live. */
const RESTART_DELAY_MS = 400;

const MIC_BLOCKED = 'Microphone access is blocked. Allow it for this extension, or type instead.';

export const VOICE_PREF_KEY = 'voicelink:voiceEnabled';

/**
 * The persisted "audio by default" switch, shared by the popup and the side panel through
 * `storage.local` so toggling it in one place takes hold everywhere. Defaults to on.
 */
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
  /** A finalized phrase — the speaker paused, this chunk will not change. */
  onFinal: (text: string) => void;
  /** The evolving in-progress transcript, for a live "…" preview. */
  onInterim?: (text: string) => void;
}

export interface Speech {
  supported: boolean;
  listening: boolean;
  error: string | null;
  /** Begin (or re-attempt, after a permission error) listening. */
  start: () => void;
  stop: () => void;
}

/**
 * Continuous speech recognition with interim results, hardened for an extension page: it
 * requests mic permission up front (Chrome's `webkitSpeechRecognition` throws `not-allowed`
 * in an extension page unless a `getUserMedia` prompt has granted it first), auto-restarts
 * after the API's silence-driven stops, and never throws — problems surface as `error`.
 */
export function useSpeech({ onFinal, onInterim }: UseSpeechOptions): Speech {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = useMemo(() => recognitionCtor() !== null, []);

  // Latest callbacks, so the long-lived recognizer's handlers never go stale.
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
        // No getUserMedia here; let recognition try to prompt on its own.
        micGrant.current = Promise.resolve();
      } else {
        micGrant.current = media
          .getUserMedia({ audio: true })
          .then((stream) => stream.getTracks().forEach((track) => track.stop()))
          .catch((cause) => {
            micGrant.current = null; // let a later attempt re-prompt
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
    if (!wanted.current) return; // stopped while the permission prompt was up

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
      // We asked it to stop, or it just heard nothing — neither is an error worth surfacing.
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wanted.current = false;
        micGrant.current = null; // force a fresh prompt on the next start()
        setError(MIC_BLOCKED);
        return;
      }
      if (event.error === 'audio-capture') {
        wanted.current = false;
        setError('No microphone was found.');
        return;
      }
      setError(event.error); // e.g. network — onend restarts and it usually recovers
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
      // start() throws only when it is already running; onstart/onend keep state honest.
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
        // already stopped
      }
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, error, start, stop };
}
