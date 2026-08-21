import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { Bot, Server } from 'lucide-react'
import {
  ORCHESTRATION_CHAIN,
  ORCHESTRATION_POINTS,
  ORCHESTRATION_SESSIONS,
  ORCHESTRATION_SHARED,
  SECTIONS,
  type Session,
  type SessionStatus,
} from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'
import { cn } from '@/lib/utils'

const STATUS: Record<SessionStatus, { dot: string; text: string; bg: string; chip: string; label: string }> = {
  working: {
    dot: 'bg-brand shadow-[0_0_8px_var(--color-brand)] animate-pulse',
    text: 'text-brand',
    bg: 'bg-brand',
    chip: 'bg-brand/12 text-brand',
    label: 'at work',
  },
  approval: {
    dot: 'bg-ember shadow-[0_0_8px_var(--color-ember)] animate-pulse',
    text: 'text-ember',
    bg: 'bg-ember',
    chip: 'bg-ember/14 text-ember',
    label: 'waiting on you',
  },
  queued: {
    dot: 'bg-ink-faint/60',
    text: 'text-ink-faint',
    bg: 'bg-ink-faint',
    chip: 'bg-surface/70 text-ink-faint',
    label: 'holding',
  },
}

const LIVE = ORCHESTRATION_SESSIONS.filter((s) => s.status !== 'queued')

/* ------------------------------------------------------------------ the browser */

function TabStrip({
  active,
  onPick,
}: {
  active: number
  onPick: (i: number) => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {ORCHESTRATION_SESSIONS.map((session, i) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onPick(i)}
          aria-label={`${session.tab}, ${STATUS[session.status].label}`}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] transition-colors',
            i === active ? 'bg-surface/80 text-ink' : 'text-ink-faint hover:text-ink-dim',
          )}
        >
          <span className="relative flex size-3 shrink-0 rounded-[3px] bg-surface-2/90">
            <span
              className={cn(
                'absolute -right-1 -bottom-1 size-1.5 rounded-full ring-2 ring-ground',
                STATUS[session.status].dot,
              )}
            />
          </span>
          <span className="hidden truncate sm:inline">{session.tab}</span>
        </button>
      ))}
    </div>
  )
}

function PageArea({ session, index }: { session: Session; index: number }) {
  const status = STATUS[session.status]
  const ringed = index % 4

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-ground-2/50 p-3">
      <div className="flex gap-3">
        <div className="hidden w-16 shrink-0 flex-col gap-1.5 sm:flex">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-2 rounded-full bg-surface-2/60" style={{ width: `${92 - n * 14}%` }} />
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-2.5 w-24 rounded-full bg-surface-2/80" />
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={cn(
                'flex items-center gap-2 rounded border px-2 py-1.5 transition-colors duration-500',
                n === ringed && session.status !== 'queued'
                  ? session.status === 'approval'
                    ? 'border-ember/50 bg-ember/8'
                    : 'border-brand/45 bg-brand/8'
                  : 'border-line/70 bg-ground/50',
              )}
            >
              <div className="h-1.5 flex-1 rounded-full bg-surface-2/60" style={{ maxWidth: `${74 - n * 12}%` }} />
              <div className="h-1.5 w-6 rounded-full bg-surface-2/40" />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5 rounded-full border border-line bg-ground/80 px-2 py-1 backdrop-blur">
        <span className={cn('size-1.5 rounded-full', status.dot)} />
        <span className="font-mono text-[9.5px] text-ink-faint">{status.label} in this tab</span>
      </div>
    </div>
  )
}

function SidePanel({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  const reduce = useReducedMotion()
  const session = ORCHESTRATION_SESSIONS[active]
  const status = STATUS[session.status]

  return (
    <div className="flex w-[190px] shrink-0 flex-col rounded-lg border border-line bg-ground-2/70 p-2.5 sm:w-[228px]">
      <div className="flex items-center gap-1.5 border-b border-line pb-2">
        <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_var(--color-lime)]" />
        <span className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
          Browsentic · paired
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        <div className="px-1 font-mono text-[9px] tracking-[0.14em] text-ink-faint uppercase">
          sessions
        </div>
        {ORCHESTRATION_SESSIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(i)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left transition-colors',
              i === active ? 'bg-surface/60' : 'hover:bg-surface/30',
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', STATUS[s.status].dot)} />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[10px]',
                i === active ? 'text-ink' : 'text-ink-faint',
              )}
            >
              {s.tab}
            </span>
            <span className="shrink-0 font-mono text-[9px] text-ink-faint">{s.timeline.length}</span>
          </button>
        ))}
      </div>

      <div className="mt-2.5 border-t border-line pt-2.5">
        <AnimatePresence mode="wait">
          <motion.div
            key={session.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-[11px] leading-snug font-medium text-ink">{session.title}</div>

            <ul className="mt-2 space-y-1.5">
              {session.timeline.map((line, i) => (
                <li key={line} className="flex gap-1.5">
                  <span
                    className={cn(
                      'mt-1.5 size-1 shrink-0 rounded-full',
                      i === session.timeline.length - 1 ? status.bg : 'bg-ink-faint/50',
                    )}
                  />
                  <span className="text-[10px] leading-snug text-ink-faint">{line}</span>
                </li>
              ))}
            </ul>

            {session.status === 'approval' ? (
              <div className="mt-2.5 flex gap-1.5">
                <span className="flex-1 rounded bg-brand py-1 text-center text-[9.5px] font-medium text-ground">
                  Allow
                </span>
                <span className="flex-1 rounded border border-line-strong py-1 text-center text-[9.5px] text-ink-dim">
                  Deny
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  'mt-2.5 inline-flex rounded-full px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase',
                  status.chip,
                )}
              >
                {session.agent} · {status.label}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function BrowserMock({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  const session = ORCHESTRATION_SESSIONS[active]

  return (
    <div className="card flex min-w-0 flex-1 flex-col overflow-hidden p-1.5">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex shrink-0 gap-1.5">
          <span className="size-2 rounded-full bg-ember/70" />
          <span className="size-2 rounded-full bg-amber/60" />
          <span className="size-2 rounded-full bg-lime/50" />
        </span>
        <TabStrip active={active} onPick={onPick} />
      </div>

      <div className="mb-1.5 flex items-center gap-2 rounded-md border border-line bg-ground/70 px-2.5 py-1">
        <span className="size-1.5 rounded-full bg-lime/60" />
        <span className="truncate font-mono text-[10px] text-ink-faint">{session.host}</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-1.5 rounded-[0.7rem] bg-ground/60 p-1.5">
        <PageArea session={session} index={active} />
        <SidePanel active={active} onPick={onPick} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the way out */

function Rail({ label, back }: { label: string; back?: boolean }) {
  const reduce = useReducedMotion()
  const color = back ? 'var(--color-ember)' : 'var(--color-brand)'

  return (
    <div>
      <div className="mb-1 truncate text-center font-mono text-[9px] text-ink-faint">{label}</div>
      <div className="relative flex h-2 items-center">
        <svg className="h-2 w-full" viewBox="0 0 100 8" preserveAspectRatio="none">
          <line
            x1={back ? 6 : 0}
            y1="4"
            x2={back ? 100 : 94}
            y2="4"
            stroke={color}
            strokeOpacity="0.4"
            strokeWidth="1.6"
            strokeDasharray="4 5"
            className="animate-dash"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={back ? 'M6 4 L12 1 L12 7 Z' : 'M94 4 L88 1 L88 7 Z'}
            fill={color}
            fillOpacity="0.75"
          />
        </svg>
        {!reduce && (
          <motion.span
            className="absolute size-1.5 rounded-full"
            style={{ background: color, boxShadow: `0 0 10px ${color}` }}
            initial={{ left: back ? '100%' : '0%', opacity: 0 }}
            animate={{ left: back ? ['100%', '0%'] : ['0%', '100%'], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              repeatDelay: 1.2,
              delay: back ? 0.9 : 0,
              ease: 'easeInOut',
            }}
          />
        )}
      </div>
    </div>
  )
}

function ChainNode({
  icon: Icon,
  title,
  sub,
  body,
  children,
}: {
  icon: typeof Server
  title: string
  sub: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface/60 text-brand">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
          <p className="truncate font-mono text-[10px] text-brand/80">{sub}</p>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{body}</p>
      {children}
    </div>
  )
}

function Board() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const reduce = useReducedMotion()
  const [active, setActive] = useState(0)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (!inView || reduce || pinned) return
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % ORCHESTRATION_SESSIONS.length),
      3800,
    )
    return () => window.clearInterval(id)
  }, [inView, reduce, pinned])

  const pick = (i: number) => {
    setActive(i)
    setPinned(true)
  }

  return (
    <div ref={ref} className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <BrowserMock active={active} onPick={pick} />

      <div className="hidden w-28 shrink-0 flex-col justify-center gap-7 lg:flex">
        <Rail label={ORCHESTRATION_CHAIN.out} />
        <Rail label={ORCHESTRATION_CHAIN.back} back />
      </div>

      <div className="flex items-center justify-center gap-6 lg:hidden">
        <div className="w-32">
          <Rail label={ORCHESTRATION_CHAIN.out} />
        </div>
        <div className="w-32">
          <Rail label={ORCHESTRATION_CHAIN.back} back />
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 lg:w-[290px]">
        <ChainNode icon={Server} {...ORCHESTRATION_CHAIN.daemon} />

        <ChainNode icon={Bot} {...ORCHESTRATION_CHAIN.agents}>
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {ORCHESTRATION_SESSIONS.map((s) => (
              <li
                key={s.id}
                className={cn('flex items-center gap-2', s.status === 'queued' && 'opacity-50')}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', STATUS[s.status].dot)} />
                <code className="shrink-0 font-mono text-[10.5px] text-ink">{s.agent}</code>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint">
                  {s.tab}
                </span>
                <span className={cn('shrink-0 font-mono text-[9px]', STATUS[s.status].text)}>
                  {s.status === 'queued' ? 'holding' : 'live'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-[9.5px] text-ink-faint">
            {LIVE.length} live · maxConcurrentRuns {LIVE.length} · ceiling 8
          </p>
        </ChainNode>
      </div>
    </div>
  )
}

export function Orchestration() {
  return (
    <Section id="orchestrate">
      <SectionHeading {...SECTIONS.orchestrate} />

      <Reveal>
        <div className="mt-12">
          <Board />
        </div>
      </Reveal>

      <Stagger className="mt-4 grid gap-4 md:grid-cols-2" gap={0.07}>
        {ORCHESTRATION_POINTS.map(([title, body]) => (
          <StaggerItem key={title}>
            <div className="card h-full p-5">
              <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">{body}</p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.1}>
        <div className="card mt-4 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <span className="rounded-full bg-magenta/12 px-3 py-1 font-mono text-[11px] tracking-wide text-magenta uppercase">
            {ORCHESTRATION_SHARED.chip}
          </span>
          <p className="text-sm text-ink-dim">{ORCHESTRATION_SHARED.body}</p>
        </div>
      </Reveal>
    </Section>
  )
}
