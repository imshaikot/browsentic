import { useEffect, useState } from 'react';
import { FileDown, FileText, Folder, ShieldCheck } from 'lucide-react';

import { formatWhen } from '@/lib/format-when';
import { Card, ConfirmDialog, EmptyState, PathRow, Pill, QuietButton, SectionTitle } from '../components';
import type { Model, State } from '../model';

const ago = (iso: string) => formatWhen(Date.parse(iso));

export function ActivityView({ model, state }: { model: Model; state: State }) {
  const [confirming, setConfirming] = useState<'approvals' | 'downloads' | null>(null);
  useEffect(() => void model.loadActivity(), [model]);

  const hosts = Object.entries(Object.groupBy(state.grants, (grant) => grant.host)).sort(([a], [b]) => a.localeCompare(b));
  const downloads = state.downloads?.downloads ?? [];

  return (
    <div className="space-y-4.5">
      <Card>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SectionTitle title="Standing approvals" subtitle="Every “always on this site” you have granted. These actions no longer ask on these sites." />
            </div>
            {state.grants.length > 0 && (
              <QuietButton tint="danger" onClick={() => setConfirming('approvals')}>
                Forget all
              </QuietButton>
            )}
          </div>
          {hosts.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing is pre-approved" detail="Every gated action still asks before it runs." />
          ) : (
            hosts.map(([host, grants = []]) => (
              <div key={host} className="flex items-start gap-3 rounded-xl bg-ground-2 p-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[13px] font-semibold text-ink">{host}</p>
                  <div className="flex flex-wrap gap-1.25">
                    {grants.map((grant) => (
                      <Pill key={grant.action} text={`${grant.action.replace('page.', '')} · ${ago(grant.at)}`} />
                    ))}
                  </div>
                </div>
                <QuietButton disabled={state.busy.includes('approvals')} onClick={() => void model.clearApprovals(host)}>
                  Forget
                </QuietButton>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SectionTitle title="Captured downloads" subtitle="Files an agent pulled off a page. The daemon sweeps them after two weeks." />
            </div>
            {downloads.length > 0 && (
              <QuietButton tint="danger" onClick={() => setConfirming('downloads')}>
                Delete all
              </QuietButton>
            )}
          </div>
          {state.downloads && <PathRow path={state.downloads.dir} model={model} info={state.info} />}
          {downloads.length === 0 ? (
            <EmptyState icon={FileDown} title="Nothing captured" detail="Files land here when an agent uses page.captureDownload." />
          ) : (
            downloads.map((download) => (
              <div key={download.id} className="flex items-center gap-3 rounded-xl bg-ground-2 p-3">
                <FileText className="size-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-[12.5px] font-medium text-ink">{download.name}</p>
                  <p className="truncate text-[11.5px] text-ink-dim">
                    {download.notes} · {ago(download.capturedAt)}
                  </p>
                </div>
                <QuietButton icon={Folder} onClick={() => void model.reveal(download.savedTo)}>
                  Show
                </QuietButton>
              </div>
            ))
          )}
        </div>
      </Card>

      {confirming === 'approvals' && (
        <ConfirmDialog
          title="Forget every standing approval?"
          message="Gated actions will ask again on every site."
          action="Forget all"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void model.clearApprovals();
          }}
        />
      )}
      {confirming === 'downloads' && (
        <ConfirmDialog
          title="Delete every captured download?"
          message="The files are removed from disk."
          action="Delete all"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void model.clearDownloads();
          }}
        />
      )}
    </div>
  );
}
