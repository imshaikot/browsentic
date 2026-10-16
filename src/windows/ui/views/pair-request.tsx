import { useState } from 'react';

import { formatWhen } from '@/lib/format-when';
import { SOURCE_LABEL, type Source } from '@/lib/stores';
import { ConfirmDialog, TextField } from '../components';
import { browserName, type Model, type State } from '../model';
import type { PairRequestSummary } from '../backend';

const sourceLabel = (source: string) => {
  const label = SOURCE_LABEL[source as Source] ?? source;
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** The first browser waiting to be let in; the rest wait their turn behind it. */
export function PairRequestQueue({ model, state }: { model: Model; state: State }) {
  const [request, ...behind] = state.pairRequests;
  if (state.phase !== 'main' || !request) return null;
  return <PairRequestDialog key={request.id} request={request} behind={behind.length} model={model} busy={state.busy.includes(`decide:${request.id}`)} />;
}

function PairRequestDialog({ request, behind, model, busy }: { request: PairRequestSummary; behind: number; model: Model; busy: boolean }) {
  const [name, setName] = useState(request.browser ?? '');
  const there = request.browser ?? 'this browser';

  return (
    <ConfirmDialog
      title={`${browserName(request)} wants to connect to Browsentic Bridge`}
      message={`Allow it to use your agent and drive this browser? If you didn’t just install or open Browsentic in ${there}, don’t allow it.`}
      action="Allow"
      cancel="Deny"
      tint="brand"
      dismissible={false}
      busy={busy}
      onConfirm={() => void model.decide(request, true, name)}
      onCancel={() => void model.decide(request, false)}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 rounded-xl bg-ground-2 px-3.5 py-3 text-[12px]">
        <Detail term="From" value={sourceLabel(request.source)} />
        <Detail term="Version" value={`v${request.extensionVersion}`} />
        <Detail term="Install" value={request.installId.slice(0, 8)} mono />
        <Detail term="Asked" value={formatWhen(request.firstAt)} />
      </dl>
      <TextField label="Name it" value={name} placeholder={browserName(request)} maxLength={40} onChange={setName} />
      {behind > 0 && (
        <p className="text-[11.5px] text-ink-faint">
          {behind === 1 ? 'One more browser is' : `${behind} more browsers are`} waiting after this one.
        </p>
      )}
    </ConfirmDialog>
  );
}

function Detail({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-ink-faint">{term}</dt>
      <dd className={mono ? 'font-mono text-ink select-text' : 'text-ink'}>{value}</dd>
    </>
  );
}
