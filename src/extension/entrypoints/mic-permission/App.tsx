import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Mic, MicOff } from 'lucide-react';
import { Wordmark } from '@/extension/components/brand';
import { Button } from '@/extension/components/ui/button';

type Phase = 'asking' | 'granted' | 'refused' | 'no-microphone';

const CLOSE_AFTER_MS = 1500;

const COPY: Record<Phase, { title: string; body: string }> = {
  asking: {
    title: 'Allow the microphone',
    body: 'Your browser is asking above. Choose Allow, and dictation works in the side panel, the popup and hands-free mode from then on.',
  },
  granted: {
    title: 'The microphone is on',
    body: 'This tab closes itself. Go back to Browsentic and talk.',
  },
  refused: {
    title: 'The microphone is blocked',
    body: 'Click the icon at the left of the address bar, set Microphone to Allow, then try again. Typing keeps working either way.',
  },
  'no-microphone': {
    title: 'No microphone was found',
    body: 'Plug one in or check your system sound settings, then try again.',
  },
};

async function closeThisTab() {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) await browser.tabs.remove(tab.id);
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('asking');

  const ask = useCallback(async () => {
    setPhase('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPhase('granted');
    } catch (cause) {
      setPhase(cause instanceof DOMException && cause.name === 'NotFoundError' ? 'no-microphone' : 'refused');
    }
  }, []);

  useEffect(() => void ask(), [ask]);

  useEffect(() => {
    if (phase !== 'granted') return;
    const timer = setTimeout(() => void closeThisTab(), CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const { title, body } = COPY[phase];
  const failed = phase === 'refused' || phase === 'no-microphone';

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center p-6">
      <main className="panel-card flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
        <Wordmark />
        <span
          className={
            failed
              ? 'flex size-16 items-center justify-center rounded-full border border-amber/50 bg-amber/10 text-amber'
              : 'glow-brand flex size-16 items-center justify-center rounded-full border border-brand/50 bg-brand/10 text-brand'
          }
        >
          {failed ? <MicOff className="size-7" /> : <Mic className="size-7" />}
        </span>
        <h1 className="text-base font-medium">{title}</h1>
        <p className="text-xs leading-relaxed text-ink-dim">{body}</p>
        {failed && (
          <Button size="sm" onClick={() => void ask()}>
            Try again
          </Button>
        )}
      </main>
    </div>
  );
}
