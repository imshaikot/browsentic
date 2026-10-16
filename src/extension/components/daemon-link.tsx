import { useState } from 'react';
import { Link2Off, Loader2 } from 'lucide-react';
import { browser } from 'wxt/browser';

import { PairingStatus } from '@/extension/components/pairing-status';
import { Button } from '@/extension/components/ui/button';
import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import type { PairingMode } from '@/lib/pairing';
import { useAutoPair } from '@/lib/bridge/use-auto-pair';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';

const MODE_LINE: Record<PairingMode, string> = {
  auto: 'Browsers with Browsentic connect to this computer by themselves.',
  ask: 'This computer asks you to allow each new browser.',
  code: 'Browsers connect to this computer only with a code.',
};

export function DaemonLink() {
  const daemon = useDaemonState();
  const { connect } = useAutoPair(daemon);
  const [busy, setBusy] = useState(false);

  const connected = daemon?.connected ?? false;
  const paired = daemon?.paired ?? false;
  const mode = daemon?.preferences?.pairing?.mode;

  async function disconnect() {
    setBusy(true);
    await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'disconnect' });
    setBusy(false);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Browser link</h2>
        {connected && <span className="font-mono text-[10px] text-ink-faint">127.0.0.1:{daemon?.port}</span>}
      </div>

      {paired ? (
        <>
          <p className="text-[11px] leading-relaxed text-ink-dim">
            {connected
              ? 'Browsentic Bridge is driving this browser. Disconnecting stops it until you connect again here.'
              : 'Paired, but Browsentic Bridge is not answering. Start it with browsentic start, or disconnect.'}
          </p>
          {connected && mode && (
            <p className="text-[11px] leading-relaxed text-ink-faint">
              {MODE_LINE[mode]} Change it in the app, or with <code className="font-mono">browsentic pairing</code>.
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={disconnect} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2Off />} Disconnect
          </Button>
        </>
      ) : (
        <PairingStatus daemon={daemon} onConnect={connect} />
      )}
    </section>
  );
}
