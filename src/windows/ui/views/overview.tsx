import { useEffect, useState } from 'react';
import { ChevronRight, Cpu, FileDown, KeyRound, Network, Power, Puzzle, RefreshCw, SquareArrowOutUpRight, Wrench, type LucideIcon } from 'lucide-react';

import type { BrowserRow } from '@/daemon/browsers';
import { SOURCE_LABEL } from '@/lib/stores';
import { cn } from '@/lib/utils';
import { Card, CopyButton, GlowDot, PathRow, Pill, PrimaryButton, QuietButton, SectionTitle, Step, type Tint } from '../components';
import type { DaemonPhase, Model, State } from '../model';
import type { PairingCode } from '../backend';
import { UpdateCard } from './update-card';

const TINT: Record<DaemonPhase, Tint> = { on: 'lime', off: 'faint', starting: 'amber', stopping: 'amber' };
const LABEL: Record<DaemonPhase, string> = { off: 'Off', starting: 'Starting', on: 'Running', stopping: 'Stopping' };

export function OverviewView({ model, state }: { model: Model; state: State }) {
  const { daemon, status, lock } = state;
  const connected = status?.connected === true;
  const title = {
    on: connected ? 'Your browser is in the loop' : 'Waiting for your browser',
    off: 'Browsentic is off',
    starting: 'Starting Browsentic Bridge',
    stopping: 'Shutting down',
  }[daemon];
  const subtitle = {
    on: connected
      ? 'Open the side panel in your browser and say what you want. This window can close: Browsentic Bridge keeps running.'
      : 'Browsentic Bridge is running. Add the extension to your browser below and pair it once, and the side panel comes alive.',
    off: 'Turn it on and the side panel in your browser can reach the agent you already run.',
    starting: 'One moment.',
    stopping: 'One moment.',
  }[daemon];

  return (
    <div className="space-y-4.5">
      {state.update && <UpdateCard model={model} state={state} />}

      <Card className="p-6.5">
        <div className="flex items-center gap-7">
          <PowerOrb phase={daemon} onToggle={() => void model.setDaemon(daemon === 'off')} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <GlowDot tint={TINT[daemon]} pulsing={daemon === 'on'} />
              <span className={cn('text-[11px] font-bold tracking-[0.11em] uppercase', TEXT_TINT[TINT[daemon]])}>{LABEL[daemon]}</span>
            </div>
            <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
            <p className="text-[13px] text-ink-dim">{subtitle}</p>
            {daemon === 'on' && (
              <QuietButton icon={RefreshCw} className="mt-1" disabled={state.busy.includes('restart')} onClick={() => void model.restartDaemon()}>
                Restart
              </QuietButton>
            )}
          </div>
        </div>
      </Card>

      {status && lock && (
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Address" value={`127.0.0.1:${status.port}`} icon={Network} />
          <Stat label="Bridge" value={`v${status.daemonVersion}`} detail={`pid ${lock.pid}`} icon={Cpu} />
          <Stat
            label="Extension"
            value={connected ? 'Connected' : 'Not connected'}
            detail={status.extensionVersion && `v${status.extensionVersion}`}
            icon={Puzzle}
            tint={connected ? 'lime' : 'amber'}
          />
          <Stat
            label="Tools"
            value={status.manifestInSync ? 'In sync' : 'The extension’s'}
            detail={status.manifestInSync ? undefined : 'versions differ, which is fine'}
            icon={Wrench}
            tint={status.manifestInSync ? 'lime' : 'brand'}
          />
        </div>
      )}

      <ExtensionCard model={model} state={state} />
      {daemon === 'on' && (status?.pairedBrowsers === 0 || state.pairing) && <ConnectCard model={model} state={state} />}
      {!state.update && <UpdateCard model={model} state={state} />}
    </div>
  );
}

const TEXT_TINT: Record<Tint, string> = {
  brand: 'text-brand',
  lime: 'text-lime',
  amber: 'text-amber',
  danger: 'text-destructive',
  ember: 'text-ember',
  magenta: 'text-magenta',
  dim: 'text-ink-dim',
  faint: 'text-ink-faint',
};

function PowerOrb({ phase, onToggle }: { phase: DaemonPhase; onToggle: () => void }) {
  const on = phase === 'on';
  const moving = phase === 'starting' || phase === 'stopping';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={moving}
      title={on ? 'Turn Browsentic Bridge off' : 'Turn Browsentic Bridge on'}
      aria-label={on ? 'Turn Browsentic Bridge off' : 'Turn Browsentic Bridge on'}
      className="relative size-[148px] shrink-0 rounded-full transition-transform duration-300 hover:scale-103"
    >
      {on && <span className="breathe absolute inset-0 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_calc(var(--glow)*0.55),transparent)_45%,transparent)]" />}
      <span
        className={cn('ring inset-3.5', (on || moving) && 'spin')}
        style={{
          background: moving
            ? 'conic-gradient(var(--brand) 0 35%, transparent 35%)'
            : on
              ? 'conic-gradient(var(--brand), var(--ember), var(--magenta), var(--brand))'
              : 'var(--line-strong)',
        }}
      />
      <span className="absolute inset-6.5 rounded-full border border-line-strong bg-gradient-to-b from-surface-2 to-ground-2 shadow-[0_6px_10px_rgb(0_0_0/0.35)]" />
      <Power
        className={cn('absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2', on ? 'neon-text text-brand' : 'text-ink-faint')}
        strokeWidth={3}
      />
    </button>
  );
}

function Stat({ label, value, detail, icon: Icon, tint = 'brand' }: { label: string; value: string; detail?: string; icon: LucideIcon; tint?: Tint }) {
  return (
    <div className="space-y-1.5 rounded-[14px] border border-line bg-surface/72 p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-2.5', TEXT_TINT[tint])} strokeWidth={3} />
        <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-faint uppercase">{label}</span>
      </div>
      <p className="truncate font-display text-[15px] font-semibold text-ink">{value}</p>
      <p className="font-mono text-[10.5px] text-ink-dim">{detail ?? ' '}</p>
    </div>
  );
}

export function ConnectCard({ model, state }: { model: Model; state: State }) {
  return (
    <Card>
      <div className="space-y-4">
        <SectionTitle
          title="Pair a browser"
          subtitle="Click Browsentic in your browser’s toolbar (the puzzle piece lists it), enter the code, and press Connect. It works once and expires in ten minutes."
        />
        {state.pairing ? (
          <PairingCodeView pairing={state.pairing} model={model} />
        ) : (
          <PrimaryButton icon={KeyRound} disabled={state.busy.includes('pair')} onClick={() => void model.newPairingCode()}>
            Get a pairing code
          </PrimaryButton>
        )}
      </div>
    </Card>
  );
}

function PairingCodeView({ pairing, model }: { pairing: PairingCode; model: Model }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const left = Math.max(0, Math.floor((pairing.expiresAt - now) / 1000));
  const grouped = pairing.code.length > 4 ? `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}` : pairing.code;

  return (
    <div className="flex items-center gap-4.5">
      <div className="flex gap-1.5">
        {[...grouped].map((character, index) =>
          character === '-' ? (
            <span key={index} className="self-center font-mono text-[22px] text-ink-faint">
              –
            </span>
          ) : (
            <span
              key={index}
              className="flex h-11 w-8.5 items-center justify-center rounded-[9px] border border-brand/30 bg-ground-2 font-mono text-2xl font-bold text-brand select-text"
            >
              {character}
            </span>
          ),
        )}
      </div>
      <div className="space-y-1.5">
        <p className={cn('font-mono text-xs', left < 60 ? 'text-amber' : 'text-ink-dim')}>
          {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'}
        </p>
        <div className="flex gap-2">
          <CopyButton value={grouped} label="Copy code" />
          <QuietButton onClick={() => void model.newPairingCode()}>New code</QuietButton>
        </div>
      </div>
    </div>
  );
}

function ExtensionCard({ model, state }: { model: Model; state: State }) {
  const [shown, setShown] = useState<boolean>();
  // Open from the start for someone who already loads the unpacked folder.
  const unpacked = shown ?? !!state.stamp;
  const subtitle = state.sessions.some((session) => session.connected)
    ? 'In your browser and talking to Browsentic Bridge. Store copies update themselves.'
    : 'Add it from your browser’s store, then click Browsentic in the toolbar and enter the pairing code once.';

  return (
    <Card>
      <div className="space-y-3.5">
        <SectionTitle title="The extension" subtitle={subtitle} />
        <div className="space-y-2">
          {model.offeredBrowsers.map((row) => (
            <BrowserExtensionRow key={row.id} row={row} model={model} state={state} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShown(!unpacked)}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-dim transition hover:text-ink"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', unpacked && 'rotate-90')} />
          Load it unpacked instead
        </button>
        {unpacked && (
          <div className="space-y-3 border-l border-line pl-4">
            <p className="text-[12px] text-ink-dim">
              For a browser that cannot reach a store, such as ungoogled Chromium or a managed profile, or to try a build the stores do not have yet.
            </p>
            {state.info && <PathRow path={state.info.paths.extensionDir} model={model} info={state.info} />}
            <div className="space-y-2">
              <Step number={1}>Open chrome://extensions and turn on Developer mode.</Step>
              <Step number={2}>Press “Load unpacked”, then paste the folder above into the picker’s address bar.</Step>
              <Step number={3}>Click Browsentic in the toolbar and enter a pairing code.</Step>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {state.browsers
                .filter((browser) => !/firefox/i.test(browser.name))
                .slice(0, 3)
                .map((browser) => (
                  <QuietButton key={browser.path} icon={SquareArrowOutUpRight} onClick={() => void model.openExtensionsPage(browser)}>
                    Extensions in {browser.name}
                  </QuietButton>
                ))}
              <div className="flex-1" />
              <QuietButton icon={FileDown} disabled={state.busy.includes('extension')} onClick={() => void model.reinstallExtension()}>
                {state.stamp ? 'Write it again' : 'Write it'}
              </QuietButton>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function BrowserExtensionRow({ row, model, state }: { row: BrowserRow; model: Model; state: State }) {
  const copy = row.sessions.find((session) => session.connected) ?? row.sessions[0];
  const stale = copy?.source === 'unpacked' && !!state.stamp && copy.extensionVersion !== state.stamp.version;
  const where = copy
    ? `${SOURCE_LABEL[copy.source ?? 'unpacked']} · v${copy.extensionVersion}`
    : row.installed
      ? row.store
      : `${row.store} · not found on this computer`;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-ground-2 px-3 py-2.5">
      <GlowDot tint={copy?.connected ? 'lime' : 'faint'} pulsing={!!copy?.connected} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{row.label}</p>
        <p className="truncate text-[11.5px] text-ink-dim">{where}</p>
      </div>
      {stale && <Pill text="Reload needed" tint="amber" icon={RefreshCw} />}
      {copy ? (
        <Pill text={copy.connected ? 'Connected' : 'Not connected'} tint={copy.connected ? 'lime' : 'dim'} />
      ) : (
        <QuietButton icon={Puzzle} tint="brand" disabled={state.busy.includes(`add:${row.id}`)} onClick={() => void model.addExtension(row)}>
          {row.id === 'firefox' ? 'Get the Firefox add-on' : `Add to ${row.label}`}
        </QuietButton>
      )}
    </div>
  );
}
