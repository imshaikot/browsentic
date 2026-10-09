import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { ArrowLeft, ArrowRight, Layers, Loader2, Plus, RotateCw, Smartphone, Unplug, X } from 'lucide-react';
import { Button } from '@/extension/components/ui/button';
import { ANDROID_PROTOCOL } from '@/lib/actions/protocol';
import { askPhone, usePhoneSession } from '@/lib/bridge/phone-client';
import type { PhoneEndReason, PhoneSession } from '@/lib/bridge/phone';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { addressOf } from '@/lib/phone/mirror';
import { cn } from '@/lib/utils';
import { useMirror, type Mirror } from './use-mirror';

const ENDED: Record<PhoneEndReason, string> = {
  unplugged: 'The phone was disconnected.',
  'chrome-exited': 'Chrome closed on the phone.',
  'bridge-stopping': 'Browsentic Bridge stopped.',
  'bridge-gone': 'The link to Browsentic Bridge went down.',
  closed: 'Android was switched off.',
};

const CHROME_RETRY_MS = 3_000;
/** The status strip, the address bar and the frame's padding, above and around the screen. */
const FRAME_CHROME_PX = { height: 104, width: 24 };
const CHROME_RETRY_FOR_MS = 15_000;

async function closeThisTab() {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) await browser.tabs.remove(tab.id);
}

/** The largest screen of this aspect that fits the space the frame has, so the phone's picture is never stretched. */
function useFit(aspect: number) {
  const area = useRef<HTMLDivElement | null>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = Math.max(0, Math.min(space.height - FRAME_CHROME_PX.height, (space.width - FRAME_CHROME_PX.width) / aspect));
  return { area, screen: { width: Math.round(height * aspect), height: Math.round(height) } };
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const listener = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);
  return visible;
}

export default function App() {
  const session = usePhoneSession();
  const daemon = useDaemonState();
  const visible = useVisible();
  const live = !!session && !session.ended && !session.waitingForChrome;
  const mirror = useMirror(live && visible);
  const device = daemon?.android?.devices.find((each) => each.serial === session?.serial);
  const asleep = device?.problem?.code === 'SCREEN_OFF';
  const tooOld = !!daemon?.connected && (daemon.protocolVersion ?? 0) < ANDROID_PROTOCOL;

  useEffect(() => {
    document.title = `Android · ${session?.model ?? 'Browsentic'}`;
  }, [session?.model]);

  const wasAsleep = useRef(asleep);
  const { send } = mirror;
  useEffect(() => {
    if (wasAsleep.current && !asleep && live) send({ op: 'restart' });
    wasAsleep.current = asleep;
  }, [asleep, live, send]);

  const overlay = tooOld ? (
    <Notice icon={<Unplug className="size-6" />} title="Update Browsentic Bridge" body="This Bridge predates Android. Run “browsentic update”, then switch Android on again." />
  ) : !session ? (
    <Notice icon={<Smartphone className="size-6" />} title="Android is off" body="Switch on Android in the Browsentic side panel to show your phone here." />
  ) : session.ended ? (
    <Ended session={session} />
  ) : session.waitingForChrome ? (
    <WaitingForChrome session={session} />
  ) : !mirror.image ? (
    <Notice icon={<Loader2 className="size-6 animate-spin" />} title="Connecting" body={`Showing ${session.model ?? 'your phone'}…`} />
  ) : asleep ? (
    <Notice icon={<Smartphone className="size-6" />} title="Wake your phone to see it here" body="Chrome stops drawing while the screen is off." />
  ) : null;

  return (
    <div className="dot-grid flex h-screen flex-col items-center gap-3 overflow-hidden p-4">
      <Header session={session} />
      <PhoneFrame session={session} device={device} mirror={mirror} live={live} overlay={overlay} />
      {mirror.error && <p className="rounded-lg border border-destructive/40 bg-surface px-3 py-1.5 text-xs text-ink">{mirror.error}</p>}
    </div>
  );
}

function Header({ session }: { session: PhoneSession | null }) {
  const daemon = useDaemonState();
  const phones = daemon?.android?.devices.filter((device) => device.state === 'ready') ?? [];
  if (phones.length < 2 || !session) return null;
  return (
    <select
      aria-label="Phone"
      value={session.serial}
      onChange={(event) => void askPhone({ op: 'phoneStart', serial: event.target.value, windowId: session.windowId })}
      className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink"
    >
      {phones.map((phone) => (
        <option key={phone.serial} value={phone.serial}>
          {phone.model ?? phone.serial}
        </option>
      ))}
    </select>
  );
}

function PhoneFrame({
  session,
  device,
  mirror,
  live,
  overlay,
}: {
  session: PhoneSession | null;
  device?: { transport: 'usb' | 'wifi'; screen?: { width: number; height: number } };
  mirror: Mirror;
  live: boolean;
  overlay: ReactNode;
}) {
  const [tabsOpen, setTabsOpen] = useState(false);
  const aspect = mirror.image ? mirror.image.width / mirror.image.height : device?.screen ? device.screen.width / device.screen.height : 9 / 19.5;
  const { area, screen } = useFit(aspect);
  return (
    <div ref={area} className="flex min-h-0 w-full flex-1 items-start justify-center">
      <div className="flex flex-col rounded-[2.25rem] border border-line-strong bg-surface p-2.5 shadow-2xl" style={{ width: screen.width + FRAME_CHROME_PX.width }}>
        <div className="flex items-center justify-between px-3 pt-1 pb-2 text-[11px] text-ink-dim">
          <span className="truncate font-medium text-ink">{session?.model ?? 'Android'}</span>
          <span className="flex items-center gap-1.5">
            <span className={cn('glow-dot size-1.5 rounded-full', live ? 'bg-lime' : 'bg-amber')} />
            {device?.transport === 'wifi' ? 'Wi-Fi' : 'USB'}
          </span>
        </div>
        <AddressBar mirror={mirror} live={live} tabs={session?.targets.length ?? 0} onTabs={() => setTabsOpen((open) => !open)} />
        <div className="relative overflow-hidden rounded-[1.5rem] bg-ground" style={screen}>
          <canvas
            ref={mirror.canvas}
            tabIndex={0}
            aria-label="The phone's screen"
            className={cn('block h-full w-full touch-none outline-none', (!mirror.image || overlay) && 'opacity-30')}
          />
          {overlay && <div className="absolute inset-0 flex items-center justify-center p-6">{overlay}</div>}
          {tabsOpen && session && <TabList session={session} mirror={mirror} onClose={() => setTabsOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

function AddressBar({ mirror, live, tabs, onTabs }: { mirror: Mirror; live: boolean; tabs: number; onTabs(): void }) {
  const [typed, setTyped] = useState<string>();
  const shown = typed ?? mirror.page?.url ?? '';
  return (
    <div className="mb-2 flex items-center gap-1 rounded-full bg-ground px-1.5 py-1">
      <Button variant="ghost" size="icon-sm" title="Back" aria-label="Back" disabled={!live || !mirror.page?.canGoBack} onClick={() => mirror.send({ op: 'back' })}>
        <ArrowLeft className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Forward" aria-label="Forward" disabled={!live || !mirror.page?.canGoForward} onClick={() => mirror.send({ op: 'forward' })}>
        <ArrowRight className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Reload" aria-label="Reload" disabled={!live} onClick={() => mirror.send({ op: 'reload' })}>
        <RotateCw className="size-3.5" />
      </Button>
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (shown.trim()) mirror.send({ op: 'go', url: addressOf(shown) });
          setTyped(undefined);
        }}
      >
        <input
          aria-label="Address"
          title={mirror.page?.title}
          value={shown}
          disabled={!live}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => setTyped(undefined)}
          className="w-full truncate bg-transparent px-2 text-xs text-ink outline-none placeholder:text-ink-faint"
          placeholder="Search or type a URL"
        />
      </form>
      <Button variant="ghost" size="sm" title="Tabs on the phone" aria-label="Tabs on the phone" disabled={!live} onClick={onTabs}>
        <Layers className="size-3.5" />
        {tabs}
      </Button>
    </div>
  );
}

function TabList({ session, mirror, onClose }: { session: PhoneSession; mirror: Mirror; onClose(): void }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-ground/95 p-3 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink">Tabs on the phone</span>
        <span className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => (mirror.send({ op: 'newTab' }), onClose())}>
            <Plus className="size-3.5" />
            New tab
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close the list" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </span>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {session.targets.map((target) => (
          <li
            key={target.targetId}
            className={cn('flex items-center gap-2 rounded-lg px-2.5 py-2', target.targetId === session.activeTargetId ? 'bg-brand/12' : 'hover:bg-surface')}
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => (mirror.send({ op: 'switchTab', targetId: target.targetId }), onClose())}>
              <span className="block truncate text-xs text-ink">{target.title || target.url}</span>
              <span className="block truncate text-[11px] text-ink-faint">{target.url}</span>
            </button>
            <Button variant="ghost" size="icon-sm" aria-label={`Close ${target.title || target.url}`} onClick={() => mirror.send({ op: 'closeTab', targetId: target.targetId })}>
              <X className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="panel-card flex max-w-xs flex-col items-center gap-3 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-brand/50 bg-brand/10 text-brand">{icon}</span>
      <h1 className="text-sm font-medium">{title}</h1>
      <p className="text-xs leading-relaxed text-ink-dim">{body}</p>
      {children}
    </div>
  );
}

function WaitingForChrome({ session }: { session: PhoneSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = async () => {
    setBusy(true);
    setError(undefined);
    const started = Date.now();
    let result = await askPhone({ op: 'phoneOpenChrome' });
    while (result.ok && result.data.waitingForChrome && Date.now() - started < CHROME_RETRY_FOR_MS) {
      await new Promise((resolve) => setTimeout(resolve, CHROME_RETRY_MS));
      result = await askPhone({ op: 'phoneOpenChrome' });
    }
    setBusy(false);
    if (!result.ok) setError(result.error.message);
  };
  return (
    <Notice icon={<Smartphone className="size-6" />} title="Open Chrome on your phone" body={`Browsentic needs Chrome running on ${session.model ?? 'your phone'} to show and drive it.`}>
      <Button size="sm" disabled={busy} onClick={() => void open()}>
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Open Chrome on the phone
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Notice>
  );
}

function Ended({ session }: { session: PhoneSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reconnect = async () => {
    setBusy(true);
    const result = await askPhone({ op: 'phoneStart', serial: session.serial, windowId: session.windowId });
    setBusy(false);
    setError(result.ok ? undefined : result.error.message);
  };
  return (
    <Notice icon={<Unplug className="size-6" />} title={`${session.model ?? 'The phone'} is not connected`} body={ENDED[session.ended!.reason]}>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void reconnect()}>
          Reconnect
        </Button>
        <Button size="sm" variant="outline" onClick={() => void closeThisTab()}>
          Close tab
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Notice>
  );
}
