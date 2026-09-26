import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { micPermission, openMicPermissionPage, watchMicPermission } from './mic-permission';
import { createRecognition, recognitionCtor, transcriptOf, type SpeechRecognitionLike } from './recognition';
import { SPEECH_SERVICE_KEY, handsFreeAllowed, noteSpeechService, readSpeechService, type SpeechService } from './speech-support';

const RESTART_DELAY_MS = 400;

const MIC_BLOCKED = 'Microphone access is blocked. Allow it for this extension, or type instead.';
const NO_SPEECH_SERVICE = 'This browser has no speech service to transcribe with. Type instead.';
const MIC_NOT_GRANTED = 'Browsentic has not been given the microphone yet.';

export const VOICE_PREF_KEY = 'browsentic:voiceEnabled';

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

/** Hidden until known, so a browser without speech never sees the detach button flash on and off. */
export function useHandsFreeSupported(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let live = true;
    void readSpeechService().then((service) => {
      if (live) setSupported(handsFreeAllowed(service));
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (SPEECH_SERVICE_KEY in changes) setSupported(handsFreeAllowed(changes[SPEECH_SERVICE_KEY].newValue as SpeechService));
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return supported;
}

export interface UseSpeechOptions {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
}

export interface Speech {
  supported: boolean;
  listening: boolean;
  error: string | null;
  needsGrant: boolean;
  grant: () => void;
  start: () => void;
  stop: () => void;
}

export function useSpeech({ onFinal, onInterim }: UseSpeechOptions): Speech {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGrant, setNeedsGrant] = useState(false);
  const supported = useMemo(() => recognitionCtor() !== null, []);

  const handlers = useRef({ onFinal, onInterim });
  handlers.current = { onFinal, onInterim };

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  const blocked = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micGrant = useRef<Promise<void> | null>(null);
  const heardOnce = useRef(false);
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
    if (!recognitionCtor() || recognition.current) return;
    if ((await micPermission()) === 'prompt') {
      setListening(false);
      setNeedsGrant(true);
      setError(MIC_NOT_GRANTED);
      return;
    }
    setNeedsGrant(false);
    try {
      await ensureMic();
    } catch {
      wanted.current = false;
      blocked.current = true;
      setListening(false);
      setNeedsGrant(true);
      setError(MIC_BLOCKED);
      return;
    }
    if (!wanted.current) return;

    const speech = createRecognition();
    if (!speech) return;

    speech.onstart = () => {
      setListening(true);
      setError(null);
    };
    speech.onresult = (event) => {
      const { interim, final } = transcriptOf(event);
      if ((interim || final) && !heardOnce.current) {
        heardOnce.current = true;
        void noteSpeechService('works');
      }
      if (interim) handlers.current.onInterim?.(interim);
      if (final) handlers.current.onFinal(final);
    };
    speech.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wanted.current = false;
        blocked.current = true;
        micGrant.current = null;
        setNeedsGrant(true);
        setError(MIC_BLOCKED);
        return;
      }
      if (event.error === 'audio-capture') {
        wanted.current = false;
        setError('No microphone was found.');
        return;
      }
      if (event.error === 'network') {
        wanted.current = false;
        void noteSpeechService('missing');
        setError(NO_SPEECH_SERVICE);
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
    blocked.current = false;
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

  useEffect(
    () =>
      watchMicPermission((state) => {
        if (state === 'prompt') return;
        micGrant.current = null;
        if (state === 'denied') {
          setNeedsGrant(true);
          setError(MIC_BLOCKED);
          return;
        }
        setNeedsGrant(false);
        setError(null);
        if (blocked.current) wanted.current = true;
        blocked.current = false;
        if (wanted.current) beginRef.current();
      }),
    [],
  );

  const grant = useCallback(() => void openMicPermissionPage(), []);

  return { supported, listening, error, needsGrant, grant, start, stop };
}
