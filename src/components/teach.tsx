import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Terminal } from 'lucide-react'
import { MODES } from '@/data/content'
import { Reveal, Section, SectionHeading } from '@/components/primitives'
import { cn } from '@/lib/utils'

export function Teach() {
  const [active, setActive] = useState(0)
  const mode = MODES[active]

  return (
    <Section id="teach">
      <SectionHeading
        kicker="Teach it"
        title="It gets better at your sites, not just better in general"
        lede="Three ways to close the gap between a capable agent and one that already knows its way around: let it map a site once, show it a job once, or let the browser answer the easy things itself."
      />

      <Reveal delay={0.1}>
        <div
          role="tablist"
          aria-label="Ways to teach Browsentic"
          className="mt-12 inline-flex flex-wrap gap-1 rounded-full border border-line bg-ground-2/60 p-1 backdrop-blur"
        >
          {MODES.map((m, i) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={cn(
                'relative rounded-full px-4 py-2 text-sm font-medium transition-colors sm:px-5',
                active === i ? 'text-ground' : 'text-ink-dim hover:text-ink',
              )}
            >
              {active === i && (
                <motion.span
                  layoutId="teach-tab"
                  className="absolute inset-0 rounded-full bg-brand"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative">{m.tab}</span>
            </button>
          ))}
        </div>
      </Reveal>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode.id}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start"
        >
          <div className="card p-7 sm:p-9">
            <span className="font-mono text-[11px] tracking-[0.16em] text-ember uppercase">
              {mode.kicker}
            </span>
            <h3 className="mt-4 text-[clamp(1.35rem,2.7vw,1.9rem)] leading-tight font-semibold text-ink">
              {mode.title}
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-dim">{mode.body}</p>

            <div className="mt-6 flex items-center gap-2.5 rounded-lg border border-line bg-ground/60 px-3.5 py-2.5">
              <Terminal className="size-3.5 shrink-0 text-brand" />
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                {mode.invocation}
              </code>
            </div>

            <ul className="mt-7 space-y-4">
              {mode.points.map(([title, body]) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand/70" />
                  <div>
                    <div className="text-sm font-semibold text-ink">{title}</div>
                    <div className="mt-0.5 text-sm leading-relaxed text-ink-dim">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card overflow-hidden p-1.5 lg:sticky lg:top-28">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="size-2 rounded-full bg-ember/60" />
              <span className="size-2 rounded-full bg-amber/50" />
              <span className="size-2 rounded-full bg-lime/40" />
            </div>
            <div className="rounded-[0.7rem] bg-ground/70 p-4">
              <ul className="space-y-2">
                {mode.tree.map(([left, right], i) => (
                  <motion.li
                    key={left}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.12 + i * 0.06, duration: 0.35 }}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
                  >
                    <code className="font-mono text-[12px] whitespace-pre text-ink">{left}</code>
                    {right && (
                      <span className="font-mono text-[11px] text-ink-faint">{right}</span>
                    )}
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </Section>
  )
}
