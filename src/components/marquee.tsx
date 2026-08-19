import { ALL_TOOLS } from '@/data/content'

export function ToolMarquee() {
  const row = [...ALL_TOOLS, 'browsentic_status']

  return (
    <div className="relative overflow-hidden py-3">
      <div className="mask-x flex w-max animate-marquee gap-2.5 will-change-transform">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 gap-2.5" aria-hidden={copy === 1}>
            {row.map((t) => (
              <span
                key={t}
                className="rounded-lg border border-line bg-ground-2/50 px-3.5 py-2 font-mono text-xs whitespace-nowrap text-ink-faint"
              >
                {t}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
