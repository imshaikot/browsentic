import { useState } from 'react';
import { AudioLines, Mic, MicOff, PanelRightOpen, Send, Sparkles } from 'lucide-react';

import { DaemonLink } from '@/components/daemon-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { useRun } from '@/lib/bridge/use-run';
import { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { cn } from '@/lib/utils';

export default function App() {
  const daemon = useDaemonState();
  const run = useRun();
  const [micOn, setMicOn] = useState(false);

  const connected = daemon?.connected ?? false;

  async function openSidePanel() {
    const win = await browser.windows.getCurrent();
    if (win.id != null) {
      await browser.sidePanel.open({ windowId: win.id });
      window.close();
    }
  }

  const voice = useVoiceComposer({
    active: micOn && connected,
    onSubmit: (text) => {
      setMicOn(false);
      run.send(text);
      void openSidePanel();
    },
  });

  function submit() {
    if (!connected) return;
    voice.submitNow();
  }

  function toggleMic() {
    if (!voice.supported) return;
    if (micOn && voice.error) {
      voice.retry();
      return;
    }
    setMicOn((on) => !on);
  }

  const hint = !connected
    ? 'Pair this browser to start'
    : voice.error
      ? voice.error
      : micOn && voice.listening
        ? voice.interim || 'Listening… speak, then pause'
        : run.running
          ? 'Working — open the side panel to watch'
          : voice.supported
            ? 'Tap to talk, or type below'
            : 'Type your instruction below';

  return (
    <div className="flex w-80 flex-col">
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
          <AudioLines className="size-4" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm leading-none font-semibold">VoiceLink</h1>
          <p className="mt-1 text-xs text-muted-foreground">AI voice assistant</p>
        </div>
        <Badge variant="secondary">
          <Sparkles /> Beta
        </Badge>
      </header>

      <main className="flex flex-col items-center gap-4 px-4 py-6">
        <button
          type="button"
          aria-label={micOn ? 'Stop listening' : 'Start listening'}
          onClick={toggleMic}
          disabled={!connected || !voice.supported}
          className={cn(
            'relative flex size-20 items-center justify-center rounded-full text-white shadow-lg transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            (!connected || !voice.supported) && 'opacity-40',
            micOn
              ? 'bg-destructive'
              : 'bg-gradient-to-br from-violet-500 to-indigo-600 enabled:hover:scale-105',
          )}
        >
          {micOn && voice.listening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />
          )}
          {micOn ? <MicOff className="size-8" /> : <Mic className="size-8" />}
        </button>

        <p className={cn('text-center text-sm', voice.error ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          {hint}
        </p>

        <form
          className="flex w-full gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            value={voice.input}
            onChange={(event) => voice.setInput(event.target.value)}
            placeholder="What should I do?"
            aria-label="Instruction for VoiceLink"
            className="h-8 text-xs"
            disabled={!connected}
          />
          <Button type="submit" size="sm" disabled={!connected || !voice.input.trim()}>
            <Send />
          </Button>
        </form>
      </main>

      <footer className="space-y-2 border-t p-3">
        <Button variant="outline" className="w-full" onClick={openSidePanel}>
          <PanelRightOpen /> Open chat side panel
        </Button>
        <DaemonLink />
      </footer>
    </div>
  );
}
