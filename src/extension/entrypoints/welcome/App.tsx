import { useEffect, useState, type ReactNode } from 'react';
import { Check, PanelRight, Pin } from 'lucide-react';
import { browser } from 'wxt/browser';

import { AgentPicker } from '@/extension/components/agent-picker';
import { Logo } from '@/extension/components/brand';
import { PairingStatus } from '@/extension/components/pairing-status';
import { Button } from '@/extension/components/ui/button';
import { hasSidePanel, openSidePanel } from '@/lib/bridge/side-panel';
import { useAutoPair } from '@/lib/bridge/use-auto-pair';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { cn } from '@/lib/utils';

/** Opened once, when the extension is installed: it finds Browsentic Bridge, or says how to get it, and connects by itself. */
export default function App() {
  const daemon = useDaemonState();
  const { connect } = useAutoPair(daemon);
  const connected = daemon?.connected ?? false;
  const [windowId, setWindowId] = useState<number | null>(null);

  // Read ahead of the click: opening the panel needs the gesture, and an await spends it.
  useEffect(() => {
    void browser.windows.getCurrent().then((window) => setWindowId(window.id ?? null));
  }, []);

  return (
    <main className="dot-grid min-h-screen bg-background px-6 py-14 text-ink">
      <div className="mx-auto max-w-xl space-y-8">
        <header className="flex items-start gap-3">
          <Logo className="mt-1 size-9 shrink-0 text-brand" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Browsentic is in your browser</h1>
            <p className="text-sm leading-relaxed text-ink-dim">
              Your browser’s superpower: free, open source, and no API key, subscription or account. It runs on the agent
              CLI you already use, through Browsentic Bridge on this computer.
            </p>
          </div>
        </header>

        <ol className="space-y-3">
          <Step done title="The extension, in this browser">Added.</Step>
          <Step done={connected} title="Browsentic Bridge, on this computer">
            {connected ? 'Connected. Everything stays on this computer.' : <PairingStatus daemon={daemon} onConnect={connect} />}
          </Step>
          <Step done={connected && !!daemon?.agent} title="An agent CLI you’re signed in to">
            {connected ? <AgentPicker /> : 'Claude Code, Codex or another supported one. You can pick it once the Bridge is connected.'}
          </Step>
        </ol>

        {connected && (
          <section className="panel-card space-y-3 rounded-xl p-5">
            {hasSidePanel() ? (
              <p className="text-sm text-ink">You’re set. Open the side panel and tell it what to do on any page.</p>
            ) : (
              <p className="text-sm text-ink">You’re set. Click Browsentic in the toolbar and tell it what to do on any page.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {hasSidePanel() && (
                <Button onClick={() => windowId !== null && void openSidePanel(windowId)} disabled={windowId === null}>
                  <PanelRight /> Open the side panel
                </Button>
              )}
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint">
                <Pin className="size-3.5" /> Pin Browsentic from the puzzle piece in the toolbar to keep it one click away.
              </span>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="panel-card flex gap-3 rounded-xl p-4">
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
          done ? 'border-lime/60 bg-lime/15 text-lime' : 'border-line text-ink-faint',
        )}
      >
        {done && <Check className="size-3" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium text-ink">{title}</p>
        <div className="text-xs leading-relaxed text-ink-dim">{children}</div>
      </div>
    </li>
  );
}
