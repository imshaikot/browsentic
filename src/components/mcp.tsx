import { Boxes, GitBranch, Plug } from 'lucide-react'
import { ALL_TOOLS, HERO, MCP_POINTS, SECTIONS } from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'
import { CopyCommand } from '@/components/copy-command'
import { ToolMarquee } from '@/components/marquee'

const ICONS = { clients: Plug, manifest: GitBranch, extend: Boxes }

export function Mcp() {
  return (
    <Section id="mcp">
      <SectionHeading {...SECTIONS.mcp} />

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.05fr] lg:items-start">
        <Stagger className="space-y-4" gap={0.08}>
          {MCP_POINTS.map((p) => {
            const Icon = ICONS[p.id]
            return (
              <StaggerItem key={p.id}>
                <div className="card flex gap-4 p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface/50 text-brand">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-ink">{p.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">{p.body}</p>
                  </div>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>

        <Reveal delay={0.12}>
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="size-2 rounded-full bg-ember/60" />
              <span className="size-2 rounded-full bg-amber/50" />
              <span className="size-2 rounded-full bg-lime/40" />
              <span className="ml-2 font-mono text-[11px] text-ink-faint">zsh · claude</span>
            </div>

            <div className="space-y-1.5 p-5 font-mono text-[12.5px] leading-relaxed">
              <div>
                <span className="text-brand/70">$ </span>
                <span className="text-ink">claude mcp add browsentic -- browsentic-mcp</span>
              </div>
              <div className="text-lime">✓ Added MCP server "browsentic"</div>
              <div className="h-2" />
              <div>
                <span className="text-brand/70">$ </span>
                <span className="text-ink">browsentic-mcp status</span>
              </div>
              <div className="text-ink-dim">daemon      running · pid 48213</div>
              <div className="text-ink-dim">extension   connected · chrome</div>
              <div className="text-ink-dim">
                sessions    1 paired origin
              </div>
              <div className="text-ink-dim">
                tools       {ALL_TOOLS.length} page · 1 status · 3 resources
              </div>
              <div className="h-2" />
              <div>
                <span className="text-brand/70">$ </span>
                <span className="text-ink">browsentic-mcp skills</span>
              </div>
              <div className="text-ink-dim">acme-com          site map · 14 pages · active</div>
              <div className="text-ink-dim">weekly-invoices   recording · 6 steps</div>
              <div>
                <span className="text-brand/70">$ </span>
                <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-brand animate-blink" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.1}>
        <div className="mt-8">
          <ToolMarquee />
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <div className="mx-auto mt-6 max-w-lg">
          <CopyCommand command={HERO.command} />
        </div>
      </Reveal>
    </Section>
  )
}
