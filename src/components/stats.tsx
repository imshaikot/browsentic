import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { STATS } from '@/data/content'
import { Reveal } from '@/components/primitives'

function useCountUp(to: number, active: boolean, ms = 1200) {
  const reduce = useReducedMotion()
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!active) return
    if (reduce || to === 0) {
      setN(to)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start) / ms, 1)
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
      setN(Math.round(to * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, active, ms, reduce])

  return n
}

function Stat({ value, suffix, label, note }: (typeof STATS)[number]) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const n = useCountUp(value, inView)

  return (
    <div ref={ref} className="px-2 py-6 text-center sm:py-7">
      <div className="font-display text-[clamp(2rem,4.5vw,2.75rem)] leading-none font-semibold tracking-tight text-ink tabular-nums">
        {n}
        <span className="text-brand">{suffix}</span>
      </div>
      <div className="mt-2 text-sm font-medium text-ink-dim">{label}</div>
      <div className="mt-1 text-xs text-ink-faint">{note}</div>
    </div>
  )
}

export function Stats() {
  return (
    <div className="relative px-5 sm:px-8">
      <Reveal className="mx-auto w-full max-w-6xl">
        <div className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          {STATS.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
      </Reveal>
    </div>
  )
}
