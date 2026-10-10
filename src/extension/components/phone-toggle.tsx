import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { browser } from 'wxt/browser';
import { ANDROID_PROTOCOL } from '@/lib/actions/protocol';
import { isLive } from '@/lib/bridge/phone';
import { askPhone, usePhoneSession } from '@/lib/bridge/phone-client';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import type { AndroidState } from '@/lib/phone/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

const ERROR_SHOWN_MS = 6_000;

/** The first phone adb has a connection to; Chrome closed on it is handled once the session starts. */
export const drivablePhone = (android: AndroidState | undefined) => android?.devices.find((device) => device.state === 'ready');

export function PhoneToggle() {
  const daemon = useDaemonState();
  const session = usePhoneSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(undefined), ERROR_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [error]);

  if (import.meta.env.FIREFOX) return null;
  const android = daemon?.connected && (daemon.protocolVersion ?? 0) >= ANDROID_PROTOCOL ? daemon.android : undefined;
  const on = isLive(session);
  if (!on && !android?.devices.length) return null;

  const phone = drivablePhone(android);
  const blocked = !on && !phone;
  const title = blocked ? (android?.devices[0]?.problem?.message ?? 'The phone is not ready.') : 'Drive Chrome on your Android phone';

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    const result = on
      ? await askPhone({ op: 'phoneEnd' })
      : await askPhone({ op: 'phoneStart', serial: phone!.serial, windowId: (await browser.windows.getCurrent()).id });
    setBusy(false);
    if (!result.ok) setError(result.error.message);
  };

  return (
    <span className="relative">
      <Button
        variant={on ? 'subtle' : 'ghost'}
        size="icon-sm"
        title={title}
        aria-label="Android"
        aria-pressed={on}
        disabled={busy || blocked}
        onClick={() => void toggle()}
      >
        <Smartphone className={cn('size-3.5', busy && 'animate-pulse')} />
      </Button>
      {error && (
        <span
          role="status"
          className="absolute top-full right-0 z-20 mt-1.5 w-56 rounded-lg border border-destructive/40 bg-surface px-2.5 py-1.5 text-[11.5px] text-ink shadow-lg"
        >
          {error}
        </span>
      )}
    </span>
  );
}
