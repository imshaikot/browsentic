import { ArrowRight, BookOpen } from 'lucide-react'
import { QUICKSTART, REPO, SECTIONS } from '@/data/content'
import { Button, Reveal, Section, SectionHeading } from '@/components/primitives'
import { CodeBlock } from '@/components/copy-command'

const DOCS = [
  { href: `${REPO}/blob/main/docs/guide/install.md`, title: 'Install and pair', body: 'Prerequisites, setup, pairing, first run, and driving it from a non-Claude agent.' },
  { href: `${REPO}/tree/main/docs/guide/features`, title: 'Features', body: 'Every capability, and when to reach for it.' },
  { href: `${REPO}/blob/main/docs/guide/approvals.md`, title: 'Approvals', body: 'What asks before acting, what is refused outright, and how to change either.' },
  { href: `${REPO}/tree/main/docs/internals`, title: 'Architecture', body: 'How an instruction becomes a click, end to end.' },
  { href: `${REPO}/blob/main/docs/reference/tools.md`, title: 'All 35 tools', body: 'Every tool published to an MCP client, and the action behind each one.' },
  { href: `${REPO}/blob/main/docs/guide/troubleshooting.md`, title: 'Troubleshooting', body: 'What each error means, and the fix that clears it.' },
]

export function QuickStart() {
  return (
    <Section id="start">
      <SectionHeading {...SECTIONS.start} />

      <ol className="mt-14 space-y-4">
        {QUICKSTART.map((step, i) => (
          <Reveal key={step.n} as="li" delay={i * 0.05}>
            <div className="card relative grid gap-5 p-6 sm:p-7 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-medium text-brand">{step.n}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">{step.body}</p>
              </div>

              {step.lang === 'path' ? (
                <div className="rounded-xl border border-line bg-ground/70 p-4">
                  <div className="font-mono text-[11px] text-ink-faint">Load unpacked →</div>
                  <code className="mt-1 block font-mono text-sm text-brand">{step.code}</code>
                </div>
              ) : (
                <CodeBlock code={step.code} lang={step.lang} />
              )}
            </div>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={0.12}>
        <div className="mt-10">
          <div className="flex items-center gap-2.5">
            <BookOpen className="size-4 text-ink-faint" />
            <h3 className="text-base font-semibold text-ink">Full documentation</h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOCS.map((d) => (
              <a
                key={d.title}
                href={d.href}
                target="_blank"
                rel="noreferrer noopener"
                className="card group p-5 transition-colors hover:border-brand/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{d.title}</span>
                  <ArrowRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">{d.body}</p>
              </a>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button href={REPO} external>
            Clone the repository
            <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Button>
          <Button href={`${REPO}/issues`} variant="ghost" external>
            Report an issue
          </Button>
        </div>
      </Reveal>
    </Section>
  )
}
