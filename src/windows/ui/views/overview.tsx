import { useEffect, useState } from 'react';
import { Cpu, FileDown, KeyRound, Network, Power, Puzzle, RefreshCw, SquareArrowOutUpRight, Wrench, type LucideIcon } from 'lucide-react';

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
    starting: 'Bringing the daemon up',
    stopping: 'Shutting down',
  }[daemon];
  const subtitle = {
    on: connected
      ? 'Open the side panel in your browser and say what you want. This window can close: the daemon keeps running.'
      : 'The daemon is listening. Load the extension and pair it, and the side panel comes alive.',
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
          <Stat label="Daemon" value={`v${status.daemonVersion}`} detail={`pid ${lock.pid}`} icon={Cpu} />
          <Stat
            label="Extension"
            value={connected ? 'Connected' : 'Not connected'}
            detail={status.extensionVersion && `v${status.extensionVersion}`}
            icon={Puzzle}
            tint={connected ? 'lime' : 'amber'}
          />
          <Stat
            label="Tools"
            value={status.manifestInSync ? 'In sync' : 'Drifted'}
            detail={status.manifestInSync ? undefined : 'reload the extension'}
            icon={Wrench}
            tint={status.manifestInSync ? 'lime' : 'amber'}
          />
        </div>
      )}

      {daemon === 'on' && (status?.pairedBrowsers === 0 || state.pairing) && <ConnectCard model={model} state={state} />}
      <ExtensionCard model={model} state={state} />
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
      title={on ? 'Turn the daemon off' : 'Turn the daemon on'}
      aria-label={on ? 'Turn the daemon off' : 'Turn the daemon on'}
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
          subtitle="Open the Browsentic popup in your browser, paste the code, and press Connect. It works once and expires in ten minutes."
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
  const connected = state.status?.connected === true;
  const reload = model.extensionNeedsReload;
  const subtitle = reload
    ? 'A newer build is unpacked than the one your browser has loaded. Press ↻ on the Browsentic card at chrome://extensions.'
    : connected
      ? 'Loaded and talking to the daemon. The folder below has to stay where it is: the browser’s pairing is tied to the path.'
      : 'Browsers only load an unpacked extension by hand, so these three steps are yours.';

  return (
    <Card>
      <div className="space-y-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <SectionTitle title="The extension" subtitle={subtitle} />
          </div>
          {state.stamp && <Pill text={`v${state.stamp.version} unpacked`} tint="brand" />}
          {reload && <Pill text="Reload needed" tint="amber" icon={RefreshCw} />}
        </div>
        {state.info && <PathRow path={state.info.paths.extensionDir} model={model} info={state.info} />}
        {!connected && (
          <div className="space-y-2">
            <Step number={1}>Open chrome://extensions and turn on Developer mode.</Step>
            <Step number={2}>Press “Load unpacked”, then paste the folder above into the picker’s address bar.</Step>
            <Step number={3}>Open the Browsentic popup and paste a pairing code.</Step>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {state.browsers.slice(0, 3).map((browser) => (
            <QuietButton key={browser.path} icon={SquareArrowOutUpRight} onClick={() => void model.openExtensionsPage(browser)}>
              Extensions in {browser.name}
            </QuietButton>
          ))}
          <div className="flex-1" />
          <QuietButton icon={FileDown} disabled={state.busy.includes('extension')} onClick={() => void model.reinstallExtension()}>
            Write it again
          </QuietButton>
        </div>
      </div>
    </Card>
  );
}
