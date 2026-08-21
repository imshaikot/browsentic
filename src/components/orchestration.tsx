import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { Check, Clock, PanelsTopLeft, ShieldQuestion } from 'lucide-react'
import {
  ORCHESTRATION_POINTS,
  ORCHESTRATION_RUNS,
  ORCHESTRATION_SHARED,
  SECTIONS,
  type OrchestrationRun,
  type RunStep,
} from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'
import { cn } from '@/lib/utils'

type Status = 'queued' | 'running' | 'approval' | 'done'

const STATUS: Record<Status, { text: string; bar: string; chip: string; dot: string }> = {
  queued: {
    text: 'text-ink-faint',
    bar: 'bg-ink-faint/35',
    chip: 'bg-surface/70 text-ink-faint',
    dot: 'bg-ink-faint/60',
  },
  running: {
    text: 'text-brand',
    bar: 'bg-brand',
    chip: 'bg-brand/12 text-brand',
    dot: 'bg-brand shadow-[0_0_9px_var(--color-brand)] animate-pulse',
  },
  approval: {
    text: 'text-ember',
    bar: 'bg-ember',
    chip: 'bg-ember/14 text-ember',
    dot: 'bg-ember shadow-[0_0_9px_var(--color-ember)] animate-pulse',
  },
  done: {
    text: 'text-lime',
    bar: 'bg-lime/70',
    chip: 'bg-lime/12 text-lime',
    dot: 'bg-lime/70',
  },
}

const span = (run: OrchestrationRun) => run.steps.reduce((total, s) => total + s.ms, 0)

const LOOP = Math.max(...ORCHESTRATION_RUNS.map((r) => r.start + span(r))) + 2600

/** The frame shown to anyone who asked for less motion: three running, one still queued. */
const POSTER = 4000

type Frame = { status: Status; progress: number; step?: RunStep }

function frameOf(run: OrchestrationRun, t: number): Frame {
  const total = span(run)
  const elapsed = t - run.start

  if (elapsed < 0) return { status: 'queued', progress: 0 }
  if (elapsed >= total) return { status: 'done', progress: 1 }

  let acc = 0
  for (const step of run.steps) {
    if (elapsed < acc + step.ms) {
      return { status: step.gate ? 'approval' : 'running', progress: elapsed / total, step }
    }
    acc += step.ms
  }
  return { status: 'done', progress: 1 }
}

function useLoopClock(active: boolean) {
  const [t, setT] = useState(POSTER)

  useEffect(() => {
    if (!active) return
    const started = performance.now()
    const id = window.setInterval(() => setT((performance.now() - started) % LOOP), 90)
    return () => window.clearInterval(id)
  }, [active])

  return t
}

function Lane({ run, frame }: { run: OrchestrationRun; frame: Frame }) {
  const style = STATUS[frame.status]

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className={cn('size-2 shrink-0 rounded-full', style.dot)} />
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-dim">{run.host}</span>
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase',
            style.chip,
          )}
        >
          {frame.status}
        </span>
      </div>

      <p className="mt-1.5 truncate text-[13px] text-ink">{run.task}</p>

      <div className="mt-2 flex items-center gap-2">
        {frame.status === 'queued' && <Clock className="size-3 shrink-0 text-ink-faint" />}
        {frame.status === 'approval' && <ShieldQuestion className="size-3 shrink-0 text-ember" />}
        {frame.status === 'done' && <Check className="size-3 shrink-0 text-lime/80" />}

        <code className={cn('shrink-0 font-mono text-[11px]', style.text)}>
          {frame.status === 'queued' && 'waiting for a slot'}
          {frame.status === 'done' && 'done'}
          {frame.step?.tool}
        </code>

        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
          {frame.status === 'queued' && 'three already running'}
          {frame.status === 'done' && run.result}
          {frame.step?.note}
        </span>

        {frame.status === 'approval' && (
          <span className="flex shrink-0 gap-1">
            <span className="rounded bg-brand px-1.5 py-0.5 text-[9px] font-medium text-ground">
              Allow
            </span>
            <span className="rounded border border-line-strong px-1.5 py-0.5 text-[9px] text-ink-dim">
              Deny
            </span>
          </span>
        )}
      </div>

      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface/70">
        <div
          className={cn('h-full rounded-full transition-[width] duration-100 ease-linear', style.bar)}
          style={{ width: `${Math.round(frame.progress * 100)}%` }}
        />
      </div>
    </li>
  )
}

function Board() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-60px' })
  const reduce = useReducedMotion()
  const t = useLoopClock(inView && !reduce)

  const frames = ORCHESTRATION_RUNS.map((run) => frameOf(run, t))
  const count = (s: Status) => frames.filter((f) => f.status === s).length
  const live = count('running') + count('approval')

  return (
    <div ref={ref} className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <PanelsTopLeft className="size-3.5 shrink-0 text-ink-faint" />
        <span className="font-mono text-[10.5px] tracking-[0.16em] text-ink-faint uppercase">
          sessions
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
          <span className="rounded-full bg-brand/12 px-2 py-0.5 text-brand tabular-nums">
            {live} running
          </span>
          <span className="rounded-full bg-surface/70 px-2 py-0.5 text-ink-faint tabular-nums">
            {count('queued')} queued
          </span>
          <span className="rounded-full bg-lime/12 px-2 py-0.5 text-lime tabular-nums">
            {count('done')} done
          </span>
        </span>
      </div>

      <ul className="divide-y divide-line">
        {ORCHESTRATION_RUNS.map((run, i) => (
          <Lane key={run.id} run={run} frame={frames[i]} />
        ))}
      </ul>

      <div className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-faint">
        maxConcurrentRuns 3 · ceiling 8 · sessions open 8
      </div>
    </div>
  )
}

export function Orchestration() {
  return (
    <Section id="orchestrate">
      <SectionHeading {...SECTIONS.orchestrate} />

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_0.95fr] lg:items-start">
        <Reveal>
          <Board />
        </Reveal>

        <Stagger className="space-y-4" gap={0.08}>
          {ORCHESTRATION_POINTS.map(([title, body]) => (
            <StaggerItem key={title}>
              <div className="card p-5">
                <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">{body}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>

      <Reveal delay={0.1}>
        <div className="card mt-6 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <span className="rounded-full bg-brand/12 px-3 py-1 font-mono text-[11px] tracking-wide text-brand uppercase">
            {ORCHESTRATION_SHARED.chip}
          </span>
          <p className="text-sm text-ink-dim">{ORCHESTRATION_SHARED.body}</p>
        </div>
      </Reveal>
    </Section>
  )
}
