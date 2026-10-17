import { useState } from 'react';
import { Globe, PencilLine, RotateCcw } from 'lucide-react';

import { formatWhen } from '@/lib/format-when';
import { SOURCE_LABEL } from '@/lib/stores';
import { Card, ConfirmDialog, EmptyState, GlowDot, OfflineHint, Pill, QuietButton, SectionTitle, TextField } from '../components';
import { sessionName, type Model, type State } from '../model';
import type { BlockedBrowser, PairedBy, PairingMode, SessionSummary } from '../backend';
import { ConnectCard } from './overview';

const extensionId = (origin: string) => origin.replace(/^[a-z-]+-extension:\/\//, '').replace(/\/$/, '');
const ago = (iso: string) => formatWhen(Date.parse(iso));

const PAIRED_BY: Record<PairedBy, string> = { auto: 'Paired by itself', approved: 'Allowed', code: 'Paired with a code' };

const NONE_PAIRED: Record<PairingMode, string> = {
  auto: 'Add the extension from the Overview tab, and it connects by itself.',
  ask: 'Add the extension from the Overview tab, then allow it here when it asks to connect.',
  code: 'Add the extension from the Overview tab, or get a code above and enter it in the Browsentic side panel.',
};

type Asking = { kind: 'unpair' | 'rename'; session: SessionSummary } | { kind: 'unpair-all' };

export function BrowsersView({ model, state }: { model: Model; state: State }) {
  const [asking, setAsking] = useState<Asking>();
  if (state.daemon !== 'on') return <OfflineHint what="Paired browsers" model={model} daemonOff={state.daemon === 'off'} />;
  const close = () => setAsking(undefined);

  return (
    <div className="space-y-4.5">
      <ConnectCard model={model} state={state} />
      <Card>
        <div className="space-y-3.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SectionTitle
                title="Paired browsers"
                subtitle="Each one holds a key of its own. Unpairing drops the key, disconnects it at once, and keeps it out until you reconnect it."
              />
            </div>
            {state.sessions.length > 1 && (
              <QuietButton tint="danger" onClick={() => setAsking({ kind: 'unpair-all' })}>
                Unpair all
              </QuietButton>
            )}
          </div>
          {state.sessions.length === 0 ? (
            <EmptyState icon={Globe} title="No browser is paired" detail={NONE_PAIRED[state.pairingMode ?? 'code']} />
          ) : (
            state.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                busy={state.busy.includes('revoke') || state.busy.includes(`label:${session.id}`)}
                onRename={state.status?.pairing ? () => setAsking({ kind: 'rename', session }) : undefined}
                onUnpair={() => setAsking({ kind: 'unpair', session })}
              />
            ))
          )}
        </div>
      </Card>
      {state.blocked.length > 0 && <KeptOut model={model} state={state} />}
      {asking?.kind === 'unpair-all' && (
        <ConfirmDialog
          title="Unpair every browser?"
          message="They won’t reconnect by themselves until you reconnect them."
          action="Unpair all"
          onCancel={close}
          onConfirm={() => {
            close();
            void model.revoke();
          }}
        />
      )}
      {asking?.kind === 'unpair' && (
        <ConfirmDialog
          title={`Unpair ${sessionName(asking.session)}?`}
          message="It won’t reconnect by itself until you reconnect it."
          action="Unpair"
          onCancel={close}
          onConfirm={() => {
            close();
            void model.revoke(asking.session);
          }}
        />
      )}
      {asking?.kind === 'rename' && <RenameDialog session={asking.session} model={model} onClose={close} />}
    </div>
  );
}

function SessionRow({ session, busy, onRename, onUnpair }: { session: SessionSummary; busy: boolean; onRename?: () => void; onUnpair: () => void }) {
  const name = session.label ?? session.browser;
  const paired = `${PAIRED_BY[session.pairedBy ?? 'code'] ?? 'Paired'} ${ago(session.pairedAt)}`;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ground-2 p-3">
      <GlowDot tint={session.connected ? 'lime' : 'faint'} pulsing={session.connected} />
      <div className="min-w-0 flex-1 space-y-0.75">
        {name && <p className="truncate text-[13px] font-medium text-ink">{name}</p>}
        <p className={name ? 'truncate font-mono text-xs text-ink-dim select-text' : 'truncate font-mono text-xs text-ink select-text'}>
          {session.label && session.browser && session.label !== session.browser && <span className="font-sans">{session.browser} · </span>}
          {extensionId(session.origin)}
        </p>
        <p className="text-[11.5px] text-ink-dim">
          {SOURCE_LABEL[session.source ?? 'unpacked']} · v{session.extensionVersion} · {paired} · seen {ago(session.lastSeenAt)}
        </p>
      </div>
      <Pill text={session.connected ? 'Connected' : 'Away'} tint={session.connected ? 'lime' : 'dim'} />
      {onRename && (
        <QuietButton icon={PencilLine} disabled={busy} onClick={onRename}>
          Rename
        </QuietButton>
      )}
      <QuietButton tint="danger" disabled={busy} onClick={onUnpair}>
        Unpair
      </QuietButton>
    </div>
  );
}

function RenameDialog({ session, model, onClose }: { session: SessionSummary; model: Model; onClose: () => void }) {
  const [label, setLabel] = useState(session.label ?? session.browser ?? '');
  return (
    <ConfirmDialog
      title={`Rename ${sessionName(session)}`}
      message="The name this computer shows for it, to tell two profiles of one browser apart. Leave it empty to use the browser’s own name."
      action="Save"
      tint="brand"
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        void model.rename(session, label);
      }}
    >
      <TextField label="Name" value={label} placeholder={session.browser} maxLength={40} onChange={setLabel} />
    </ConfirmDialog>
  );
}

function KeptOut({ model, state }: { model: Model; state: State }) {
  return (
    <Card>
      <div className="space-y-3.5">
        <SectionTitle title="Kept out" subtitle="Browsers you unpaired or denied. None of them connects by itself until you reconnect it." />
        {state.blocked.map((browser) => (
          <KeptOutRow key={browser.installId} browser={browser} model={model} busy={state.busy.includes(`reconnect:${browser.installId}`)} />
        ))}
      </div>
    </Card>
  );
}

function KeptOutRow({ browser, model, busy }: { browser: BlockedBrowser; model: Model; busy: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ground-2 p-3">
      <GlowDot tint="faint" />
      <div className="min-w-0 flex-1 space-y-0.75">
        <p className="truncate text-[13px] font-medium text-ink">{browser.browser ?? 'A browser'}</p>
        <p className="text-[11.5px] text-ink-dim">
          {browser.reason === 'revoked' ? 'Unpaired' : 'Denied'} {ago(browser.at)} · <span className="font-mono select-text">{browser.installId.slice(0, 8)}</span>
        </p>
      </div>
      <QuietButton icon={RotateCcw} tint="brand" disabled={busy} onClick={() => void model.reconnect(browser)}>
        Reconnect
      </QuietButton>
    </div>
  );
}
