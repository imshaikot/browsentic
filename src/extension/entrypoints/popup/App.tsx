import { useState } from 'react';
import { Mic, MicOff, PanelRightOpen, Send } from 'lucide-react';

import { AgentPicker } from '@/extension/components/agent-picker';
import { Wordmark } from '@/extension/components/brand';
import { DaemonLink } from '@/extension/components/daemon-link';
import { StatusPill, describeStatus, type StatusBlocker } from '@/extension/components/status-pill';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { openSidePanel } from '@/lib/bridge/side-panel';
import { useRun } from '@/lib/bridge/use-run';
import { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { cn } from '@/lib/utils';

const BLOCKED: Record<StatusBlocker, string> = {
  unpaired: 'Pair this browser to start',
  offline: 'The daemon isn’t answering — start browsentic',
  agent: 'That agent cannot run — pick another below',
};

export default function App() {
  const daemon = useDaemonState();
  const run = useRun();
  const [micOn, setMicOn] = useState(false);

  const paired = daemon?.paired ?? false;

  async function revealPanel() {
    const win = await browser.windows.getCurrent();
    if (win.id != null) {
      await openSidePanel(win.id);
      window.close();
    }
  }

  const voice = useVoiceComposer({
    active: micOn && (daemon?.connected ?? false),
    onSubmit: (text) => {
      setMicOn(false);
      run.send(text);
      void revealPanel();
    },
  });

  const status = describeStatus(daemon, { running: run.running, listening: micOn && voice.listening });
  const ready = status.ready;

  function submit() {
    if (!ready) return;
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

  const hint = status.blocker
    ? BLOCKED[status.blocker]
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
    <div className="flex w-[22rem] flex-col">
      <header className="flex items-center gap-2 px-4 py-3">
        <Wordmark className="flex-1" />
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </header>

      {paired && (
        <main className="dot-grid flex flex-col items-center gap-4 border-y border-line px-4 py-6">
          <button
            type="button"
            aria-label={micOn ? 'Stop listening' : 'Start listening'}
            onClick={toggleMic}
            disabled={!ready || !voice.supported}
            className={cn(
              'relative flex size-20 items-center justify-center rounded-full border transition-all outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ground',
              (!ready || !voice.supported) && 'opacity-40',
              micOn
                ? 'border-magenta/60 bg-magenta/15 text-magenta'
                : 'glow-brand border-brand/50 bg-brand/10 text-brand enabled:hover:scale-105 enabled:hover:bg-brand/20',
            )}
          >
            {micOn && voice.listening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-magenta/25" />
            )}
            {micOn ? <MicOff className="size-8" /> : <Mic className="size-8" />}
          </button>

          <p
            className={cn(
              'min-h-8 text-center text-xs leading-relaxed',
              voice.error || !status.ready ? 'text-amber' : 'text-ink-dim',
            )}
          >
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
              aria-label="Instruction for Browsentic"
              className="h-8 text-xs"
              disabled={!ready}
            />
            <Button type="submit" size="sm" aria-label="Send" disabled={!ready || !voice.input.trim()}>
              <Send />
            </Button>
          </form>

          <Button variant="outline" size="sm" className="w-full" onClick={revealPanel}>
            <PanelRightOpen /> Open the side panel
          </Button>
        </main>
      )}

      <div className="space-y-4 p-4">
        <DaemonLink />
        <AgentPicker />
      </div>
    </div>
  );
}
