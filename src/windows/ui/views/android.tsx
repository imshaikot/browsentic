import { useEffect, useState } from 'react';
import { AppWindow, Cable, ChevronDown, ChevronRight, CircleAlert, CircleArrowDown, CircleCheck, Globe, OctagonX, Play, Power, RotateCw, ShieldCheck, Smartphone, Sun, Terminal, type LucideIcon } from 'lucide-react';

import { OEM_USB_DRIVERS_URL, PHONE_TAB_COPY as COPY, PLATFORM_TOOLS_URL } from '@/lib/phone/copy';
import type { CheckMark, PhoneCheck } from '@/lib/phone/checks';
import { cn } from '@/lib/utils';
import { Card, CopyButton, OfflineHint, Pill, PrimaryButton, QuietButton, SectionTitle, Spinner, Step } from '../components';
import type { Model, State } from '../model';

const ICONS: Record<string, LucideIcon> = {
  adb: Terminal,
  Phone: Smartphone,
  'USB debugging': Cable,
  Chrome: Globe,
  'Chrome open': AppWindow,
  Screen: Sun,
  Android: Power,
};

const MARKS: Record<CheckMark, { icon: LucideIcon; className: string }> = {
  passed: { icon: CircleCheck, className: 'text-lime' },
  advisory: { icon: CircleAlert, className: 'text-amber' },
  failed: { icon: OctagonX, className: 'text-destructive' },
};

export function AndroidView({ model, state }: { model: Model; state: State }) {
  const on = state.daemon === 'on';
  const [guideOpen, setGuideOpen] = useState<boolean>();
  useEffect(() => {
    if (!on) return;
    void model.watchAndroid(true);
    return () => void model.watchAndroid(false);
  }, [model, on]);

  if (!on) return <OfflineHint what={COPY.offline} model={model} daemonOff={state.daemon === 'off'} />;
  const { android } = state;
  if (!android) {
    return (
      <div className="flex justify-center p-15">
        <Spinner />
      </div>
    );
  }
  const checking = state.busy.includes('android');
  const firstSerial = android.devices[0]?.serial;
  const open = guideOpen ?? (android.report.guided || (!state.androidReadyOnce && !android.ready));

  return (
    <div className="space-y-4.5">
      <Card>
        <div className="flex items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <SectionTitle title={COPY.title} subtitle={COPY.subtitle} />
          </div>
          {checking && <Spinner />}
          <QuietButton icon={RotateCw} disabled={checking} onClick={() => void model.loadAndroid()}>
            {COPY.checkAgain}
          </QuietButton>
        </div>
      </Card>

      <Card>
        <div className="space-y-2.5">
          <SectionTitle title={COPY.phoneCard} />
          {android.report.sections.map((section, index) => (
            <div key={section.serial ?? index} className="space-y-2.5">
              {section.serial && <p className="pt-1.5 font-mono text-[11.5px] font-semibold text-ink-dim">{section.serial}</p>}
              {section.checks.map((check) => (
                <CheckRow key={check.label} check={check} serial={section.serial ?? firstSerial} model={model} state={state} />
              ))}
            </div>
          ))}
          {android.report.summary && (
            <p className="flex items-center gap-2 pt-1 text-[12.5px] font-medium text-lime">
              <ShieldCheck className="size-4" />
              {android.report.summary}
            </p>
          )}
        </div>
      </Card>

      {android.guide.length > 0 && (
        <Card>
          <div className="space-y-3.5">
            <button type="button" onClick={() => setGuideOpen(!open)} className="flex w-full items-center gap-3 text-left">
              <div className="min-w-0 flex-1">
                <SectionTitle title={COPY.guideCard} subtitle={COPY.guideSubtitle} />
              </div>
              {open ? <ChevronDown className="size-4 text-ink-dim" /> : <ChevronRight className="size-4 text-ink-dim" />}
            </button>
            {open && (
              <div className="space-y-3">
                {android.guide.map((step, index) => (
                  <Step key={step.title} number={index + 1}>
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink">{step.title}</span>
                      {step.platform === 'android11+' && <Pill text={COPY.androidEleven} />}
                    </span>
                    {step.detail}
                  </Step>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function CheckRow({ check, serial, model, state }: { check: PhoneCheck; serial?: string; model: Model; state: State }) {
  const Icon = ICONS[check.label] ?? Smartphone;
  const { icon: Mark, className } = MARKS[check.mark];
  const working = !!serial && state.busy.includes(`android:${serial}`);
  const failing = check.mark === 'failed';
  return (
    <div className={cn('flex items-start gap-3 rounded-[14px] border bg-surface/72 px-3.5 py-2', failing ? 'border-amber/45' : 'border-line')}>
      <span className="flex size-7.5 shrink-0 items-center justify-center rounded-[9px] bg-ground-2">
        <Icon className="size-3.5 text-brand" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[13px] font-semibold text-ink">{check.label}</p>
        <p className={cn('text-[11.5px] select-text', failing ? 'text-ink' : 'text-ink-dim')}>{check.value}</p>
        {check.fix && <p className="rounded-lg bg-ground-2 px-2.5 py-1.5 font-mono text-[11.5px] break-all text-ink select-text">{check.fix}</p>}
        <Actions check={check} serial={serial} working={working} model={model} />
      </div>
      {working && <Spinner />}
      <span className="flex w-5.5 justify-center">
        <Mark className={cn('size-4.5', className)} />
      </span>
    </div>
  );
}

function Actions({ check, serial, working, model }: { check: PhoneCheck; serial?: string; working: boolean; model: Model }) {
  if (serial && check.action) {
    const launch = check.action === 'launchChrome';
    return (
      <div className="flex gap-2">
        <PrimaryButton icon={launch ? Play : CircleArrowDown} disabled={working} onClick={() => void model.openChrome(serial)}>
          {launch ? COPY.openChrome : COPY.getChrome}
        </PrimaryButton>
      </div>
    );
  }
  if (check.code === 'ADB_MISSING' && check.fix) {
    return (
      <div className="flex gap-2">
        <CopyButton value={check.fix} label={COPY.copyInstall} />
        <QuietButton icon={CircleArrowDown} onClick={() => void model.openUrl(PLATFORM_TOOLS_URL)}>
          {COPY.downloadTools}
        </QuietButton>
      </div>
    );
  }
  if (check.code === 'NO_DEVICE') {
    return (
      <div className="flex gap-2">
        <QuietButton icon={Cable} onClick={() => void model.openUrl(OEM_USB_DRIVERS_URL)}>
          {COPY.usbDrivers}
        </QuietButton>
      </div>
    );
  }
  return check.fix ? (
    <div className="flex gap-2">
      <CopyButton value={check.fix} />
    </div>
  ) : null;
}
