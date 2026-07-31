import { useState } from 'react';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { cn } from '@/lib/utils';

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
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            connected ? 'bg-emerald-500' : paired ? 'bg-amber-500' : 'bg-muted-foreground/40',
          )}
        />
        {connected
          ? `Agent control active · port ${daemon?.port}`
          : paired
            ? 'Paired · reconnecting…'
            : 'Agent control off'}
      </p>

      {paired ? (
        <Button variant="outline" size="sm" className="w-full" onClick={disconnect} disabled={busy}>
          <Link2Off /> Disconnect
        </Button>
      ) : (
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
            aria-label="Pairing code from browsentic-mcp pair"
            className="h-8 font-mono text-xs uppercase"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" size="sm" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Connect
          </Button>
        </form>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {!paired && !error && (
        <p className="text-xs text-muted-foreground">
          Run <code className="font-mono">browsentic-mcp pair</code> for a code.
        </p>
      )}
    </div>
  );
}
