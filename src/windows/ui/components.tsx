import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, Copy, Folder, Loader2, Power, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { copy, short, type Model } from './model';
import type { AppInfo } from './backend';

export type Tint = 'brand' | 'lime' | 'amber' | 'danger' | 'ember' | 'magenta' | 'dim' | 'faint';

/** Whole class names, so Tailwind sees every one of them. */
const TEXT: Record<Tint, string> = {
  brand: 'text-brand',
  lime: 'text-lime',
  amber: 'text-amber',
  danger: 'text-destructive',
  ember: 'text-ember',
  magenta: 'text-magenta',
  dim: 'text-ink-dim',
  faint: 'text-ink-faint',
};

const WASH: Record<Tint, string> = {
  brand: 'bg-brand/13',
  lime: 'bg-lime/13',
  amber: 'bg-amber/13',
  danger: 'bg-destructive/13',
  ember: 'bg-ember/13',
  magenta: 'bg-magenta/13',
  dim: 'bg-ink-dim/13',
  faint: 'bg-ink-faint/13',
};

const DOT: Record<Tint, string> = {
  brand: 'bg-brand text-brand',
  lime: 'bg-lime text-lime',
  amber: 'bg-amber text-amber',
  danger: 'bg-destructive text-destructive',
  ember: 'bg-ember text-ember',
  magenta: 'bg-magenta text-magenta',
  dim: 'bg-ink-dim text-ink-dim',
  faint: 'bg-ink-faint text-ink-faint',
};

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn('w-full rounded-2xl border border-line bg-surface/72 backdrop-blur-sm', padded && 'p-5', className)}>
      {children}
    </section>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-xs leading-relaxed text-ink-dim">{subtitle}</p>}
    </div>
  );
}

export function Pill({ text, tint = 'dim', icon: Icon }: { text: string; tint?: Tint; icon?: LucideIcon }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.25 rounded-full px-2.25 py-1 text-[11px] font-medium', TEXT[tint], WASH[tint])}>
      {Icon && <Icon className="size-2.5" strokeWidth={3} />}
      {text}
    </span>
  );
}

export function GlowDot({ tint, pulsing = false }: { tint: Tint; pulsing?: boolean }) {
  return <span className={cn('glow-dot inline-block size-2 shrink-0 rounded-full', DOT[tint], pulsing && 'animate-pulse')} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-ink-faint', className)} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; tint?: Tint };

export function PrimaryButton({ icon: Icon, tint = 'brand', className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2.25 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-40',
        tint === 'danger' ? 'glow-destructive bg-destructive text-ink' : 'glow-brand bg-brand text-ground',
        className,
      )}
    >
      {Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
}

export function QuietButton({ icon: Icon, tint, className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2/70 px-3 py-1.75 text-xs font-medium transition hover:bg-surface-2 active:scale-[0.97] disabled:opacity-40',
        tint ? TEXT[tint] : 'text-ink',
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </button>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const press = async () => {
    try {
      await copy(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <QuietButton icon={copied ? Check : Copy} tint={copied ? 'lime' : undefined} onClick={() => void press()}>
      {copied ? 'Copied' : label}
    </QuietButton>
  );
}

export function PathRow({ path, model, info }: { path: string; model: Model; info?: AppInfo }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line bg-ground-2 py-1.5 pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink select-text" title={path}>
        {short(path, info)}
      </span>
      <CopyButton value={path} />
      <QuietButton icon={Folder} onClick={() => void model.reveal(path)}>
        Show
      </QuietButton>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-11 text-center">
      <Icon className="size-7 text-ink-faint" strokeWidth={1.25} />
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      <p className="max-w-[380px] text-xs text-ink-dim">{detail}</p>
    </div>
  );
}

export function NoticeBanner({ text, isError }: { text: string; isError: boolean }) {
  const Icon = isError ? CircleAlert : CircleCheck;
  return (
    <div
      role="status"
      className={cn(
        'flex max-w-[620px] items-center gap-2.5 rounded-[14px] border bg-surface/90 px-4 py-2.75 shadow-2xl backdrop-blur-md',
        isError ? 'border-destructive/40' : 'border-lime/40',
      )}
    >
      <Icon className={cn('size-4 shrink-0', isError ? 'text-destructive' : 'text-lime')} />
      <p className="text-[12.5px] text-ink select-text">{text}</p>
    </div>
  );
}

export function OfflineHint({ what, model, daemonOff }: { what: string; model: Model; daemonOff: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-3.5">
        <Power className="size-5 shrink-0 text-amber" strokeWidth={2.5} />
        <div className="min-w-0 flex-1 space-y-0.75">
          <p className="font-display text-sm font-semibold text-ink">Browsentic Bridge is off</p>
          <p className="text-xs text-ink-dim">{what} come from Browsentic Bridge while it runs.</p>
        </div>
        <PrimaryButton disabled={!daemonOff} onClick={() => void model.setDaemon(true)}>
          Turn it on
        </PrimaryButton>
      </div>
    </Card>
  );
}

/** The ground every screen sits on: the ember black, a dot grid, and two slow washes of colour. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-ground">
      <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,#000,transparent_70%)]" />
      <div className="backdrop-wash backdrop-wash-brand" />
      <div className="backdrop-wash backdrop-wash-ember" />
    </div>
  );
}

export function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-brand/14 font-mono text-[10px] font-bold text-brand">
        {number}
      </span>
      <p className="text-[12.5px] text-ink-dim">{children}</p>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onSelect: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-line bg-ground-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onSelect(option.value)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40',
            option.value === value ? 'bg-brand/20 text-brand' : 'text-ink-faint hover:text-ink-dim',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  action,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div role="dialog" aria-modal aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-ground/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="enter w-[440px] space-y-3.5 rounded-2xl border border-line-strong bg-ground p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-ink-dim">{message}</p>
        {children}
        <div className="flex justify-end gap-2 pt-1">
          <QuietButton onClick={onCancel}>Cancel</QuietButton>
          <PrimaryButton tint="danger" onClick={onConfirm}>
            {action}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
