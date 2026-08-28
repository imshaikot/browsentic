import { cn } from '@/lib/utils';

export function Switch({
  checked,
  disabled,
  label,
  onChange,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-slot="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none',
        checked ? 'border-brand/50 bg-brand/70' : 'border-line-strong bg-surface',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <span
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none size-2.5 rounded-full bg-ink shadow-sm transition-transform',
          checked ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
