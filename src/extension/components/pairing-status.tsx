import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Check, Copy, Link2, Loader2, RefreshCw } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { LINKS } from '@/lib/about';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import type { DaemonState } from '@/lib/bridge/socket';

/** One line that installs Browsentic Bridge on any computer, and walks the person through the rest. */
const SETUP_COMMAND = 'npx browsentic@latest setup';

interface Shown {
  text: ReactNode;
  /** The action that might fix it, pressed by a person. */
  retry?: string;
  /** Lead with the code form: nothing automatic will connect this browser. */
  codeFirst?: boolean;
  busy?: boolean;
  /** Show the command that installs the Bridge, and the install guide. */
  install?: boolean;
  /** The Bridge refused this browser's key, and says why. */
  alert?: boolean;
}

const Command = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-surface px-1 py-px font-mono text-ink">{children}</code>
);

export function describePairing(daemon: DaemonState | null, unpacked: boolean): Shown {
  const pairing = daemon?.pairing;
  if (pairing?.manual) return { text: 'Disconnected. This browser won’t connect again until you connect it.', retry: 'Connect' };
  if (pairing?.wait) {
    return pairing.wait.approver === 'app'
      ? { text: 'Allow this browser in the Browsentic app. It connects the moment you do.', busy: true }
      : { text: <>Allow this browser on this computer: run <Command>browsentic approve</Command>. It connects the moment you do.</>, busy: true };
  }
  if (pairing?.blocked === 'revoked') return { text: 'This computer disconnected this browser.', retry: 'Reconnect' };
  if (pairing?.blocked === 'denied') return { text: 'This computer turned this browser down.', retry: 'Ask again' };
  if (!pairing && daemon?.error) return { text: daemon.error, codeFirst: true, alert: true };
  switch (daemon?.bridge) {
    case 'missing':
      return {
        text: 'Browsentic Bridge isn’t on this computer yet. Install it with this command in a terminal, and this browser connects by itself.',
        retry: 'Try again',
        install: true,
      };
    case 'old':
      return {
        text: (
          <>
            Browsentic Bridge needs an update to connect by itself. Update it from the app, or run{' '}
            <Command>npx browsentic@latest update</Command>.
          </>
        ),
        retry: 'Try again',
      };
    case 'forbidden':
      return unpacked
        ? { text: <>This copy isn’t registered with Browsentic Bridge. Run <Command>browsentic setup --unpacked</Command>, or pair with a code.</>, retry: 'Try again' }
        : { text: <>Browsentic Bridge needs an update to let this browser in. Run <Command>npx browsentic@latest update</Command>.</>, retry: 'Try again' };
    case 'policy':
      return { text: 'Your organization’s browser policy keeps Browsentic Bridge from starting. Pair with a code instead.', codeFirst: true };
    case 'stopped':
      return { text: <>Browsentic Bridge is turned off. Turn it on in the app, or run <Command>browsentic start</Command>.</>, retry: 'Try again' };
    case 'off':
      return { text: <>Automatic pairing is off on this computer. Pair with a code from <Command>browsentic pair</Command> or the app.</>, codeFirst: true };
    case 'failed':
      return { text: `Browsentic Bridge couldn’t start. ${pairing?.error ?? ''}`.trim(), retry: 'Try again' };
    default:
      return pairing?.error ? { text: pairing.error, retry: 'Try again' } : { text: 'Looking for Browsentic Bridge on this computer…', busy: true };
  }
}

/** What this browser needs to connect while it is not paired, with a code as the way that always works. */
export function PairingStatus({ daemon, onConnect }: { daemon: DaemonState | null; onConnect: () => Promise<void> }) {
  const [unpacked, setUnpacked] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    void browser.management.getSelf().then((self) => setUnpacked(self.installType === 'development')).catch(() => undefined);
  }, []);

  const shown = describePairing(daemon, unpacked);

  async function press() {
    setPressing(true);
    await onConnect();
    setPressing(false);
  }

  return (
    <div className="space-y-2">
      {shown.alert ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{shown.text}</p>
      ) : (
        <p className="flex gap-1.5 text-[11px] leading-relaxed text-ink-dim">
          {shown.busy && <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-brand" />}
          <span>{shown.text}</span>
        </p>
      )}

      {shown.install && <InstallSteps />}

      {(shown.install || shown.retry) && (
        <div className="flex flex-wrap gap-1.5">
          {shown.install && (
            <Button asChild variant="outline" size="sm">
              <a href={LINKS.installGuide} target="_blank" rel="noreferrer">
                <BookOpen /> Install guide
              </a>
            </Button>
          )}
          {shown.retry && (
            <Button variant={shown.install ? 'outline' : 'default'} size="sm" onClick={() => void press()} disabled={pressing}>
              {pressing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {shown.retry}
            </Button>
          )}
        </div>
      )}

      {shown.codeFirst || showCode ? (
        <CodeForm />
      ) : (
        <button
          type="button"
          onClick={() => setShowCode(true)}
          className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase transition-colors hover:text-brand"
        >
          Pair with a code instead
        </button>
      )}
    </div>
  );
}

function InstallSteps() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(SETUP_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-ground/60 py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{SETUP_COMMAND}</code>
        <Button variant="ghost" size="icon-sm" aria-label="Copy the command" onClick={() => void copy()}>
          {copied ? <Check className="text-lime" /> : <Copy />}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        It needs Node.js 20 or newer; the install guide also has the Mac and Windows apps. Already installed? Open the
        Browsentic app, or run <Command>browsentic setup</Command>. On a work computer, your organization’s browser policy may
        block it.
      </p>
    </div>
  );
}

function CodeForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pair() {
    setBusy(true);
    setError(null);
    const result = (await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'pair', token: code })) as ActionResult;
    setBusy(false);
    if (result?.ok) setCode('');
    else setError(result?.error.message ?? 'Pairing failed');
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Run <Command>browsentic pair</Command> in a terminal, or press Get a pairing code in the app, and paste the code here.{' '}
        <a
          href={LINKS.pairing}
          target="_blank"
          rel="noreferrer"
          className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-brand"
        >
          Learn more
        </a>
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
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}
