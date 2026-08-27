import { useRef, type MouseEvent } from 'react'
import { Eye, FileUp, MousePointerClick, Navigation, Radio, Video } from 'lucide-react'
import { RESOURCES, SECTIONS, TOOL_GROUPS, type ToolGroup } from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'
import { cn } from '@/lib/utils'

const ICONS: Record<ToolGroup['id'], typeof Eye> = {
  read: Eye,
  act: MousePointerClick,
  move: Navigation,
  wait: Radio,
  files: FileUp,
  recordings: Video,
}

// Tailwind only sees whole class names, so these cannot be templated.
const ACCENT: Record<ToolGroup['accent'], { text: string; ring: string; glow: string }> = {
  brand: { text: 'text-brand', ring: 'group-hover:border-brand/40', glow: 'var(--color-brand)' },
  ember: { text: 'text-ember', ring: 'group-hover:border-ember/40', glow: 'var(--color-ember)' },
  magenta: { text: 'text-magenta', ring: 'group-hover:border-magenta/40', glow: 'var(--color-magenta)' },
  lime: { text: 'text-lime', ring: 'group-hover:border-lime/40', glow: 'var(--color-lime)' },
  amber: { text: 'text-amber', ring: 'group-hover:border-amber/40', glow: 'var(--color-amber)' },
  'brand-deep': { text: 'text-brand-deep', ring: 'group-hover:border-brand-deep/40', glow: 'var(--color-brand-deep)' },
}

function CapabilityCard({ group }: { group: ToolGroup }) {
  const ref = useRef<HTMLDivElement>(null)
  const Icon = ICONS[group.id]
  const accent = ACCENT[group.accent]

  const track = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <StaggerItem className="h-full">
      <div
        ref={ref}
        onMouseMove={track}
        className={cn(
          'card group relative h-full overflow-hidden p-6 transition-colors duration-300',
          accent.ring,
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(340px circle at var(--mx, 50%) var(--my, 50%), color-mix(in oklch, ${accent.glow} 13%, transparent), transparent 68%)`,
          }}
        />

        <div className="relative">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-xl border border-line bg-surface/50',
                accent.text,
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <span className="font-mono text-[11px] text-ink-faint">
              {String(group.tools.length).padStart(2, '0')} tools
            </span>
          </div>

          <h3 className="mt-5 text-xl font-semibold text-ink">{group.label}</h3>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-dim">{group.blurb}</p>

          <ul className="mt-5 flex flex-wrap gap-1.5">
            {group.tools.map((t) => (
              <li
                key={t}
                className="rounded-md border border-line/80 bg-ground/50 px-2 py-1 font-mono text-[10.5px] text-ink-faint transition-colors group-hover:text-ink-dim"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </StaggerItem>
  )
}

export function Capabilities() {
  return (
    <Section id="capabilities">
      <SectionHeading {...SECTIONS.capabilities} />

      <Stagger className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3" gap={0.06}>
        {TOOL_GROUPS.map((g) => (
          <CapabilityCard key={g.id} group={g} />
        ))}
      </Stagger>

      <Reveal delay={0.08}>
        <div className="card mt-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-semibold text-ink">
              Three read-only MCP resources
            </h3>
            <span className="rounded-full bg-lime/12 px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-lime uppercase">
              zero tool calls
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-ink-dim">
            An MCP client can pull page context as a resource instead of spending a tool call on
            it, which is all the agent needs when it is only working out what it is looking at.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {RESOURCES.map((r) => (
              <li key={r.uri} className="rounded-lg border border-line bg-ground/40 px-3 py-2.5">
                <code className="block truncate font-mono text-[11px] text-brand">{r.uri}</code>
                <span className="mt-1 block text-xs text-ink-faint">{r.desc}</span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </Section>
  )
}
