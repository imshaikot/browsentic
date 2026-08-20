import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Eye, MousePointerClick, ShieldQuestion, Sparkles, Type, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

type Step = {
  tool: string
  detail: string
  icon: typeof Eye
  kind: 'local' | 'agent' | 'approval' | 'answer'
  focus?: 'nav' | 'filter' | 'row' | 'submit'
  ms: number
}

const PROMPT = 'find the unpaid invoices and open the newest one'

const STEPS: Step[] = [
  { tool: 'page_getPageInfo', detail: 'snapshot · 41 interactive elements', icon: Eye, kind: 'agent', ms: 1100 },
  { tool: 'page_clickElement', detail: 'text: "Invoices"', icon: MousePointerClick, kind: 'agent', focus: 'nav', ms: 1000 },
  { tool: 'page_selectOption', detail: 'status → Unpaid', icon: Type, kind: 'agent', focus: 'filter', ms: 1000 },
  { tool: 'page_submitForm', detail: 'waiting for your approval', icon: ShieldQuestion, kind: 'approval', focus: 'submit', ms: 1900 },
  { tool: 'page_scrollTo', detail: 'top of results', icon: Zap, kind: 'local', ms: 800 },
  { tool: 'page_clickElement', detail: 'row 1 · INV-2291', icon: MousePointerClick, kind: 'agent', focus: 'row', ms: 1000 },
  { tool: 'Answer', detail: 'INV-2291 · $4,120 · issued 12 Aug · 6 days overdue', icon: Sparkles, kind: 'answer', ms: 3400 },
]

const KIND_STYLE: Record<Step['kind'], string> = {
  local: 'text-amber',
  agent: 'text-brand',
  approval: 'text-ember',
  answer: 'text-lime',
}

export function HeroDemo() {
  const reduce = useReducedMotion()
  const [typed, setTyped] = useState(reduce ? PROMPT.length : 0)
  const [active, setActive] = useState(reduce ? STEPS.length : -1)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (reduce) return

    const schedule = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, ms))
    }

    const run = () => {
      setTyped(0)
      setActive(-1)

      let t = 400
      for (let i = 1; i <= PROMPT.length; i++) {
        schedule(() => setTyped(i), t)
        t += 34
      }
      t += 550
      STEPS.forEach((step, i) => {
        schedule(() => setActive(i), t)
        t += step.ms
      })
      schedule(run, t + 1600)
    }

    run()
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.length = 0
    }
  }, [reduce])

  const shown = useMemo(() => STEPS.slice(0, Math.max(active + 1, 0)), [active])
  const focus = active >= 0 ? STEPS[active]?.focus : undefined
  const approving = active >= 0 && STEPS[active]?.kind === 'approval'

  return (
    <div className="card relative overflow-hidden p-1.5 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="size-2.5 rounded-full bg-ember/70" />
        <span className="size-2.5 rounded-full bg-amber/60" />
        <span className="size-2.5 rounded-full bg-lime/50" />
        <div className="ml-2 flex-1 truncate rounded-md border border-line bg-ground/70 px-3 py-1 font-mono text-[11px] text-ink-faint">
          app.acme.com/billing
        </div>
      </div>

      <div className="grid gap-1.5 rounded-[0.7rem] bg-ground/60 p-1.5 lg:grid-cols-[1fr_310px]">
        <FauxPage focus={focus} />
        <SidePanel typed={typed} shown={shown} approving={approving} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FauxPage({ focus }: { focus?: Step['focus'] }) {
  const ring = 'ring-2 ring-brand shadow-[0_0_22px_-4px_var(--color-brand)]'

  return (
    <div className="relative h-[300px] overflow-hidden rounded-lg border border-line bg-ground-2/50 p-3 sm:h-[340px]">
      <div className="flex gap-3">
        <div className="hidden w-24 shrink-0 flex-col gap-1.5 sm:flex">
          {['Overview', 'Invoices', 'Customers', 'Settings'].map((item) => (
            <div
              key={item}
              className={cn(
                'rounded px-2 py-1.5 text-[10px] transition-all duration-300',
                item === 'Invoices'
                  ? 'bg-surface/70 text-ink-dim'
                  : 'text-ink-faint',
                focus === 'nav' && item === 'Invoices' && ring,
              )}
            >
              {item}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-24 rounded-full bg-surface-2/80" />
            <div
              className={cn(
                'ml-auto rounded border border-line bg-surface/60 px-2 py-1 text-[10px] text-ink-dim transition-all duration-300',
                focus === 'filter' && ring,
              )}
            >
              status: Unpaid
            </div>
            <div
              className={cn(
                'rounded bg-brand/85 px-2 py-1 text-[10px] font-medium text-ground transition-all duration-300',
                focus === 'submit' && ring,
              )}
            >
              Apply
            </div>
          </div>

          {[
            ['INV-2291', '$4,120', true],
            ['INV-2288', '$980', false],
            ['INV-2280', '$2,410', false],
            ['INV-2274', '$610', false],
          ].map(([id, amt, first], i) => (
            <div
              key={id as string}
              className={cn(
                'flex items-center gap-3 rounded border border-line/70 bg-ground/50 px-2.5 py-2 transition-all duration-300',
                focus === 'row' && first && ring,
              )}
            >
              <div className="font-mono text-[10px] text-ink-dim">{id}</div>
              <div className="h-1.5 flex-1 rounded-full bg-surface-2/60" style={{ maxWidth: `${72 - i * 11}%` }} />
              <div className="font-mono text-[10px] text-ink-faint">{amt}</div>
              <div className="rounded-full bg-ember/15 px-1.5 py-0.5 text-[9px] text-ember">unpaid</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SidePanel({
  typed,
  shown,
  approving,
}: {
  typed: number
  shown: Step[]
  approving: boolean
}) {
  return (
    <div className="flex h-[300px] flex-col rounded-lg border border-line bg-ground-2/70 p-3 sm:h-[340px]">
      <div className="mb-2.5 flex items-center gap-2 border-b border-line pb-2.5">
        <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_var(--color-lime)]" />
        <span className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">
          Browsentic · paired
        </span>
      </div>

      <div className="mb-3 shrink-0 rounded-md border border-line bg-ground/60 px-2.5 py-2 text-[11px] leading-snug text-ink">
        {PROMPT.slice(0, typed)}
        <span className="ml-px inline-block h-3 w-px translate-y-0.5 bg-brand animate-blink" />
      </div>

      <ul className="mask-t flex min-h-0 flex-1 flex-col justify-end space-y-1.5 overflow-hidden">
        {shown.map((step, i) => {
          const Icon = step.icon
          const isLast = i === shown.length - 1
          return (
            <motion.li
              key={`${step.tool}-${i}`}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'flex shrink-0 items-start gap-2 rounded-md border px-2 py-1.5 transition-colors',
                isLast && approving
                  ? 'border-ember/45 bg-ember/8'
                  : 'border-line/70 bg-ground/40',
              )}
            >
              <Icon className={cn('mt-px size-3 shrink-0', KIND_STYLE[step.kind])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[10px] text-ink">{step.tool}</span>
                  {step.kind === 'local' && (
                    <span className="rounded-sm bg-amber/15 px-1 text-[8px] tracking-wide text-amber uppercase">
                      local
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-ink-faint">{step.detail}</div>
              </div>
              {!isLast && <Check className="mt-px size-3 shrink-0 text-lime/70" />}
            </motion.li>
          )
        })}
      </ul>

      <motion.div
        aria-hidden={!approving}
        initial={false}
        animate={{ opacity: approving ? 1 : 0, y: approving ? 0 : 6 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="mt-2 flex shrink-0 gap-1.5"
      >
        <span className="flex-1 rounded-md bg-brand py-1.5 text-center text-[10px] font-medium text-ground">
          Allow
        </span>
        <span className="flex-1 rounded-md border border-line-strong py-1.5 text-center text-[10px] text-ink-dim">
          Deny
        </span>
      </motion.div>
    </div>
  )
}
