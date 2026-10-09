import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Smartphone, Unplug } from 'lucide-react';
import { Wordmark } from '@/extension/components/brand';
import { Button } from '@/extension/components/ui/button';
import { askPhone, usePhoneSession } from '@/lib/bridge/phone-client';
import type { PhoneEndReason, PhoneSession } from '@/lib/bridge/phone';

const ENDED: Record<PhoneEndReason, string> = {
  unplugged: 'The phone was disconnected.',
  'chrome-exited': 'Chrome closed on the phone.',
  'bridge-stopping': 'Browsentic Bridge stopped.',
  'bridge-gone': 'The link to Browsentic Bridge went down.',
  closed: 'Android was switched off.',
};

async function closeThisTab() {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) await browser.tabs.remove(tab.id);
}

function describe(session: PhoneSession | null): { title: string; body: string } {
  const phone = session?.model ?? 'your phone';
  if (!session) return { title: 'Android is off', body: 'Switch on Android in the Browsentic side panel to show your phone here.' };
  if (session.ended) return { title: `${phone} is not connected`, body: ENDED[session.ended.reason] };
  if (session.waitingForChrome) return { title: 'Open Chrome on your phone', body: `Browsentic needs Chrome running on ${phone} to show and drive it.` };
  return { title: `${phone} is connected`, body: `${session.targets.length} tab${session.targets.length === 1 ? '' : 's'} open in Chrome on the phone.` };
}

export default function App() {
  const session = usePhoneSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { title, body } = describe(session);

  useEffect(() => {
    document.title = `${session?.model ?? 'Android'} · Browsentic`;
  }, [session?.model]);

  const act = async (request: Parameters<typeof askPhone>[0]) => {
    setBusy(true);
    setError(undefined);
    const result = await askPhone(request);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
  };

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center p-6">
      <main className="panel-card flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
        <Wordmark />
        <span className="glow-brand flex size-16 items-center justify-center rounded-full border border-brand/50 bg-brand/10 text-brand">
          {session?.ended ? <Unplug className="size-7" /> : <Smartphone className="size-7" />}
        </span>
        <h1 className="text-base font-medium">{title}</h1>
        <p className="text-xs leading-relaxed text-ink-dim">{body}</p>
        {session && !session.ended && session.targets.length > 0 && (
          <ul className="w-full space-y-1 text-left text-xs text-ink-dim">
            {session.targets.map((target) => (
              <li key={target.targetId} className="truncate">
                {target.title || target.url}
              </li>
            ))}
          </ul>
        )}
        {session && !session.ended && session.waitingForChrome && (
          <Button size="sm" disabled={busy} onClick={() => void act({ op: 'phoneOpenChrome' })}>
            Open Chrome on the phone
          </Button>
        )}
        {session?.ended && (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void act({ op: 'phoneStart', serial: session.serial, windowId: session.windowId })}>
              Reconnect
            </Button>
            <Button size="sm" variant="outline" onClick={() => void closeThisTab()}>
              Close tab
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </main>
    </div>
  );
}
