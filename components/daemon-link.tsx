import { useState } from 'react';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';

export function DaemonLink() {
  const daemon = useDaemonState();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = daemon?.connected ?? false;
  const paired = daemon?.paired ?? false;

  async function pair() {
    setBusy(true);
    setError(null);
    const result = (await browser.runtime.sendMessage({
      channel: BRIDGE_CHANNEL,
      op: 'pair',
      token: code,
    })) as ActionResult;
    setBusy(false);
    if (result?.ok) setCode('');
    else setError(result?.error.message ?? 'Pairing failed');
  }

  async function disconnect() {
    setBusy(true);
    await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'disconnect' });
    setBusy(false);
    setError(null);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Browser link</h2>
        {connected && (
          <span className="font-mono text-[10px] text-ink-faint">127.0.0.1:{daemon?.port}</span>
        )}
      </div>

      {paired ? (
        <>
          <p className="text-[11px] leading-relaxed text-ink-dim">
            {connected
              ? 'The daemon is driving this browser. Disconnecting revokes the key — you will need a new pairing code.'
              : 'Paired, but the daemon is not answering. Start it with browsentic, or disconnect to pair again.'}
          </p>
          <Button variant="outline" size="sm" className="w-full" onClick={disconnect} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2Off />} Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-ink-dim">
            Run <code className="rounded bg-surface px-1 py-px font-mono text-ink">browsentic pair</code> in a
            terminal and paste the code it prints.
          </p>
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
          >
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Pairing code"
              aria-label="Pairing code from browsentic pair"
              className="h-8 font-mono text-xs tracking-widest uppercase"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="sm" disabled={busy || !code.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Connect
            </Button>
          </form>
        </>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
