import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-8', className)} aria-hidden>
      <rect
        x="2.25"
        y="4.25"
        width="27.5"
        height="23.5"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <path d="M2.5 10.5h27" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.25" />
      <circle cx="6.4" cy="7.4" r="1" fill="currentColor" fillOpacity="0.5" />
      <circle cx="9.8" cy="7.4" r="1" fill="currentColor" fillOpacity="0.35" />
      <path
        d="M9 22.2c2.4 0 2.4-6.4 6.9-6.4s4.6 6.4 7 6.4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="9" cy="22.2" r="2.35" fill="var(--color-ground)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.9" cy="15.8" r="2.55" fill="currentColor" />
      <circle cx="22.9" cy="22.2" r="2.35" fill="var(--color-ground)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Logo className="size-7 text-brand" />
      <span className="font-display text-[1.0625rem] font-semibold tracking-tight text-ink">
        Browsentic
      </span>
    </span>
  )
}
