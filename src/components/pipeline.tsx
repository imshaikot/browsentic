import { Fragment } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Bot, Chrome, Mic, Server } from 'lucide-react'
import { PIPELINE, SECTIONS } from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'

const ICONS = [Mic, Chrome, Server, Bot]

function Connector({ index }: { index: number }) {
  const reduce = useReducedMotion()

  return (
    <div
      aria-hidden
      className="relative flex shrink-0 items-center justify-center py-2 lg:w-14 lg:py-0"
    >
      <svg className="h-8 w-0.5 lg:hidden" preserveAspectRatio="none" viewBox="0 0 2 32">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="32"
          stroke="var(--color-brand)"
          strokeOpacity="0.4"
          strokeWidth="2"
          strokeDasharray="4 5"
          className="animate-dash"
        />
      </svg>

      <svg className="hidden h-0.5 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 2">
        <line
          x1="0"
          y1="1"
          x2="100"
          y2="1"
          stroke="var(--color-brand)"
          strokeOpacity="0.4"
          strokeWidth="2"
          strokeDasharray="4 5"
          className="animate-dash"
        />
      </svg>

      {!reduce && (
        <motion.span
          className="absolute hidden size-1.5 rounded-full bg-brand shadow-[0_0_10px_var(--color-brand)] lg:block"
          initial={{ left: '0%', opacity: 0 }}
          animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            repeatDelay: 1.1,
            delay: index * 0.42,
            ease: 'easeInOut',
          }}
        />
      )}
    </div>
  )
}

export function Pipeline() {
  return (
    <Section id="how">
      <SectionHeading {...SECTIONS.how} />

      <Stagger className="mt-14 flex flex-col lg:flex-row lg:items-stretch" gap={0.09}>
        {PIPELINE.map((node, i) => {
          const Icon = ICONS[i]
          return (
            <Fragment key={node.id}>
              <StaggerItem className="card group relative flex-1 p-5 transition-colors duration-300 hover:border-brand/35">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface/60 text-brand transition-colors group-hover:border-brand/40">
                    <Icon className="size-4" />
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink">{node.title}</h3>
                <p className="mt-1 font-mono text-[11px] text-brand/80">{node.sub}</p>
                <p className="mt-3 text-sm leading-relaxed text-ink-dim">{node.body}</p>
              </StaggerItem>
              {i < PIPELINE.length - 1 && <Connector index={i} />}
            </Fragment>
          )
        })}
      </Stagger>

      <Reveal delay={0.1}>
        <div className="card mt-6 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
          <span className="rounded-full bg-magenta/12 px-3 py-1 font-mono text-[11px] tracking-wide text-magenta uppercase">
            return path
          </span>
          <p className="text-sm text-ink-dim">
            Page actions travel back the way they came. The agent's tool call reaches the daemon,
            the daemon hands it to the extension over the socket the extension itself opened, and the
            result lands on the timeline in the side panel as it happens.
          </p>
        </div>
      </Reveal>
    </Section>
  )
}
