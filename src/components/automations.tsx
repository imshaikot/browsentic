import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import {
  Ban,
  Briefcase,
  Check,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Repeat,
  ShieldQuestion,
  Timer,
} from 'lucide-react'
import {
  AUTOMATIONS,
  AUTOMATION_FEATURED,
  SECTIONS,
  type Automation,
  type ToolGroup,
} from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'
import { cn } from '@/lib/utils'

const ICONS: Record<string, typeof Briefcase> = {
  support: MessagesSquare,
  cancel: Ban,
  watch: Timer,
  repeat: Repeat,
  digest: LayoutDashboard,
  bulk: ListChecks,
}

// Tailwind only sees whole class names, so these cannot be templated.
const ACCENT: Record<ToolGroup['accent'], string> = {
  brand: 'text-brand',
  ember: 'text-ember',
  magenta: 'text-magenta',
  lime: 'text-lime',
  amber: 'text-amber',
  'brand-deep': 'text-brand-deep',
}

const STEPS = AUTOMATION_FEATURED.steps
const LOOP = STEPS.reduce((total, s) => total + s.ms, 0) + 3200

function useActiveStep(active: boolean) {
  const [t, setT] = useState(LOOP)

  useEffect(() => {
    if (!active) return
    const started = performance.now()
    const id = window.setInterval(() => setT((performance.now() - started) % LOOP), 90)
    return () => window.clearInterval(id)
  }, [active])

  let acc = 0
  for (let i = 0; i < STEPS.length; i++) {
    acc += STEPS[i].ms
    if (t < acc) return i
  }
  return STEPS.length
}

function RunPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const reduce = useReducedMotion()
  const active = useActiveStep(inView && !reduce)
  const finished = active >= STEPS.length

  return (
    <div ref={ref} className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="size-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
        <span className="font-mono text-[10.5px] tracking-[0.16em] text-ink-faint uppercase">
          jobs.acme.com
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">resume.pdf attached</span>
      </div>

      <ul className="space-y-1.5 p-3">
        {STEPS.map((step, i) => {
          const done = i < active
          const current = i === active
          const gated = current && step.gate

          return (
            <li
              key={step.tool}
              className={cn(
                'rounded-lg border px-3 py-2 transition-all duration-300',
                gated && 'border-ember/45 bg-ember/8',
                current && !gated && 'border-brand/40 bg-brand/8',
                !current && 'border-line/70 bg-ground/40',
                !current && !done && 'opacity-45',
              )}
            >
              <div className="flex items-center gap-2">
                {done ? (
                  <Check className="size-3 shrink-0 text-lime/80" />
                ) : gated ? (
                  <ShieldQuestion className="size-3 shrink-0 text-ember" />
                ) : (
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      current ? 'bg-brand shadow-[0_0_8px_var(--color-brand)]' : 'bg-ink-faint/40',
                    )}
                  />
                )}
                <code className="shrink-0 font-mono text-[11px] text-ink">{step.tool}</code>
                {step.gate && (
                  <span className="ml-auto shrink-0 rounded-sm bg-ember/15 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ember uppercase">
                    asks you
                  </span>
                )}
              </div>
              <p className="mt-1 truncate pl-5 text-[11px] text-ink-faint">{step.note}</p>

              {gated && (
                <div className="mt-2 flex gap-1.5 pl-5">
                  <span className="rounded bg-brand px-2 py-0.5 text-[10px] font-medium text-ground">
                    Allow
                  </span>
                  <span className="rounded border border-line-strong px-2 py-0.5 text-[10px] text-ink-dim">
                    Deny
                  </span>
                  <span className="rounded border border-line px-2 py-0.5 text-[10px] text-ink-faint">
                    Always on jobs.acme.com
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div
        className={cn(
          'flex items-center gap-2 border-t border-line px-4 py-2.5 font-mono text-[10.5px] transition-colors duration-500',
          finished ? 'text-lime' : 'text-ink-faint',
        )}
      >
        <Check className={cn('size-3', finished ? 'opacity-100' : 'opacity-30')} />
        {AUTOMATION_FEATURED.result}
      </div>
    </div>
  )
}

function AutomationCard({ item }: { item: Automation }) {
  const Icon = ICONS[item.id]

  return (
    <StaggerItem className="h-full">
      <div className="card flex h-full flex-col p-6 transition-colors duration-300 hover:border-line-strong">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-xl border border-line bg-surface/50',
            ACCENT[item.accent],
          )}
        >
          <Icon className="size-[18px]" />
        </span>

        <h3 className="mt-5 text-[1.0625rem] leading-snug font-semibold text-ink">{item.title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-dim">{item.body}</p>

        <ul className="mt-5 flex flex-wrap gap-1.5">
          {item.tools.map((t) => (
            <li
              key={t}
              className="rounded-md border border-line/80 bg-ground/50 px-2 py-1 font-mono text-[10.5px] text-ink-faint"
            >
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-start gap-2 border-t border-line pt-4 text-[11.5px] leading-relaxed text-ink-faint">
          <ShieldQuestion className="mt-px size-3.5 shrink-0 text-ember/80" />
          {item.gate}
        </div>
      </div>
    </StaggerItem>
  )
}

export function Automations() {
  return (
    <Section id="automations">
      <SectionHeading {...SECTIONS.automations} />

      <Reveal delay={0.08}>
        <div className="card mt-12 grid gap-7 p-7 sm:p-9 lg:grid-cols-[1fr_0.95fr] lg:items-center">
          <div>
            <span className="font-mono text-[11px] tracking-[0.16em] text-ember uppercase">
              {AUTOMATION_FEATURED.kicker}
            </span>
            <h3 className="mt-4 text-[clamp(1.35rem,2.7vw,1.9rem)] leading-tight font-semibold text-ink">
              {AUTOMATION_FEATURED.title}
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-dim">
              {AUTOMATION_FEATURED.body}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10.5px] tracking-[0.16em] text-ink-faint uppercase">
                stops at
              </span>
              {AUTOMATION_FEATURED.gates.map((gate) => (
                <span
                  key={gate}
                  className="rounded-full border border-ember/35 bg-ember/8 px-2.5 py-1 font-mono text-[10.5px] text-ember"
                >
                  {gate}
                </span>
              ))}
            </div>
          </div>

          <RunPanel />
        </div>
      </Reveal>

      <Stagger className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3" gap={0.06}>
        {AUTOMATIONS.map((item) => (
          <AutomationCard key={item.id} item={item} />
        ))}
      </Stagger>
    </Section>
  )
}
