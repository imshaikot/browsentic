import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { LIMITS, SECURITY } from '@/data/content'
import { Reveal, Section, SectionHeading, Stagger, StaggerItem } from '@/components/primitives'

export function Security() {
  return (
    <Section id="security" className="relative">
      <div aria-hidden className="line-grid mask-b pointer-events-none absolute inset-0 -z-10" />

      <SectionHeading
        kicker="Privacy and security"
        title="An agent driving your real browser has to earn it"
        lede="Everything below is a property of how it is built, not a promise in a policy document. It is a local daemon, an extension that dials out to it, and no third party in between."
      />

      <Stagger className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3" gap={0.06}>
        {SECURITY.map((s) => (
          <StaggerItem key={s.title} className="h-full">
            <div className="card h-full p-6">
              <ShieldCheck className="size-5 text-lime" />
              <h3 className="mt-4 text-base font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{s.body}</p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.1}>
        <div className="mt-6 rounded-card border border-ember/25 bg-ember/[0.06] p-6 sm:p-7">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-4 shrink-0 text-ember" />
            <h3 className="text-base font-semibold text-ink">Two limits worth stating plainly</h3>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {LIMITS.map((l) => (
              <div key={l.title}>
                <div className="text-sm font-semibold text-ember/90">{l.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-dim">{l.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
