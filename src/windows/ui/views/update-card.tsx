import { BadgeCheck, CircleArrowDown, RefreshCw, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatWhen } from '@/lib/format-when';
import { Card, CopyButton, PrimaryButton, QuietButton, SectionTitle, Spinner } from '../components';
import type { Model, State } from '../model';

export const INSTALL_LINE = 'irm https://browsentic.com/install.ps1 | iex';
const RELEASES = 'https://github.com/imshaikot/browsentic/releases/tag/v';

export function UpdateCard({ model, state }: { model: Model; state: State }) {
  const { update, updatePhase: phase, info } = state;
  const current = info?.version ?? '';
  const failed = phase.kind === 'failed';
  const Icon = failed ? TriangleAlert : update ? CircleArrowDown : BadgeCheck;
  const tint = failed ? 'text-amber' : update ? 'text-brand' : 'text-lime';

  const title =
    phase.kind === 'downloading'
      ? `Downloading Browsentic ${update?.version ?? ''} · ${Math.round(phase.fraction * 100)}%`
      : phase.kind === 'relaunching'
        ? 'Reopening on the new version'
        : failed
          ? 'The update did not install'
          : update
            ? `Browsentic ${update.version} is out`
            : `Browsentic ${current} is up to date`;

  const subtitle =
    phase.kind === 'downloading'
      ? 'The daemon keeps running while this happens.'
      : phase.kind === 'relaunching'
        ? 'The app closes for a moment, then replaces the command, the daemon and the extension.'
        : failed
          ? `${phase.reason} Nothing was changed. The PowerShell line installs the same release.`
          : update
            ? `You have ${current}. One press replaces the app, then the command, the daemon and the extension, and reopens it.`
            : state.lastUpdateCheck
              ? `Checked GitHub ${formatWhen(state.lastUpdateCheck)}.`
              : 'Checks GitHub when it opens and every few hours after.';

  const checking = phase.kind === 'checking';
  const check = (label: string) => (
    <QuietButton icon={RefreshCw} disabled={checking} onClick={() => void model.checkForUpdate(true)}>
      {checking ? 'Checking…' : label}
    </QuietButton>
  );

  return (
    <Card className={cn(update && 'border-brand/45')}>
      <div className="space-y-3">
        <div className="flex items-center gap-3.5">
          <Icon className={cn('size-5.5 shrink-0', tint)} />
          <div className="min-w-0 flex-1">
            <SectionTitle title={title} subtitle={subtitle} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {phase.kind === 'downloading' || phase.kind === 'relaunching' ? (
              <Spinner />
            ) : failed ? (
              <>
                <CopyButton value={INSTALL_LINE} label="Copy the PowerShell line" />
                <PrimaryButton icon={RefreshCw} onClick={() => void model.installUpdate()}>
                  Try again
                </PrimaryButton>
              </>
            ) : update ? (
              <>
                <QuietButton onClick={() => void model.openUrl(`${RELEASES}${update.version}`)}>What’s new</QuietButton>
                <PrimaryButton icon={CircleArrowDown} onClick={() => void model.installUpdate()}>
                  Update now
                </PrimaryButton>
              </>
            ) : (
              check('Check for updates')
            )}
          </div>
        </div>
        {phase.kind === 'downloading' && (
          <div className="h-1 overflow-hidden rounded-full bg-ground-2">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(phase.fraction * 100)}%` }} />
          </div>
        )}
      </div>
    </Card>
  );
}
