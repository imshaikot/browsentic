import { useState } from 'react';
import { Globe } from 'lucide-react';

import { formatWhen } from '@/lib/format-when';
import { Card, ConfirmDialog, EmptyState, GlowDot, OfflineHint, Pill, QuietButton, SectionTitle } from '../components';
import type { Model, State } from '../model';
import type { SessionSummary } from '../backend';
import { ConnectCard } from './overview';

const extensionId = (origin: string) => origin.replace(/^[a-z-]+-extension:\/\//, '').replace(/\/$/, '');
const ago = (iso: string) => formatWhen(Date.parse(iso));

export function BrowsersView({ model, state }: { model: Model; state: State }) {
  const [confirming, setConfirming] = useState(false);
  if (state.daemon !== 'on') return <OfflineHint what="Paired browsers" model={model} daemonOff={state.daemon === 'off'} />;

  return (
    <div className="space-y-4.5">
      <ConnectCard model={model} state={state} />
      <Card>
        <div className="space-y-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SectionTitle title="Paired browsers" subtitle="Each one holds a key of its own. Unpairing drops the key and disconnects it at once." />
            </div>
            {state.sessions.length > 1 && (
              <QuietButton tint="danger" onClick={() => setConfirming(true)}>
                Unpair all
              </QuietButton>
            )}
          </div>
          {state.sessions.length === 0 ? (
            <EmptyState icon={Globe} title="No browser is paired" detail="Get a pairing code above and paste it into the Browsentic popup." />
          ) : (
            state.sessions.map((session) => <SessionRow key={session.id} session={session} model={model} busy={state.busy.includes('revoke')} />)
          )}
        </div>
      </Card>
      {confirming && (
        <ConfirmDialog
          title="Unpair every browser?"
          message="Each one will need a new pairing code to connect again."
          action="Unpair all"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void model.revoke();
          }}
        />
      )}
    </div>
  );
}

function SessionRow({ session, model, busy }: { session: SessionSummary; model: Model; busy: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ground-2 p-3">
      <GlowDot tint={session.connected ? 'lime' : 'faint'} pulsing={session.connected} />
      <div className="min-w-0 flex-1 space-y-0.75">
        {session.browser && <p className="text-[13px] font-medium text-ink">{session.browser}</p>}
        <p className={session.browser ? 'truncate font-mono text-xs text-ink-dim select-text' : 'truncate font-mono text-xs text-ink select-text'}>
          {extensionId(session.origin)}
        </p>
        <p className="text-[11.5px] text-ink-dim">
          Extension v{session.extensionVersion} · paired {ago(session.pairedAt)} · seen {ago(session.lastSeenAt)}
        </p>
      </div>
      <Pill text={session.connected ? 'Connected' : 'Away'} tint={session.connected ? 'lime' : 'dim'} />
      <QuietButton tint="danger" disabled={busy} onClick={() => void model.revoke(session)}>
        Unpair
      </QuietButton>
    </div>
  );
}
