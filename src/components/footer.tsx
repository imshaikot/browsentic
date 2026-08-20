import { Github } from 'lucide-react'
import { REPO, VERSION } from '@/data/content'
import { Wordmark } from '@/components/logo'
import { Rule } from '@/components/primitives'

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Architecture', href: '#how' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Skills', href: '#teach' },
      { label: 'MCP server', href: '#mcp' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { label: 'Installation', href: `${REPO}/blob/main/docs/installation.md`, ext: true },
      { label: 'Features', href: `${REPO}/blob/main/docs/features.md`, ext: true },
      { label: 'Architecture', href: `${REPO}/blob/main/docs/architecture.md`, ext: true },
      { label: 'Tools', href: `${REPO}/blob/main/docs/tools.md`, ext: true },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'Repository', href: REPO, ext: true },
      { label: 'Releases', href: `${REPO}/releases`, ext: true },
      { label: 'Issues', href: `${REPO}/issues`, ext: true },
      { label: 'MIT licence', href: `${REPO}/blob/main/LICENSE`, ext: true },
    ],
  },
]

export function Footer() {
  return (
    <footer className="px-5 pb-12 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Rule />
        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-faint">
              Agentic browsing, driven by the AI you already run. Built with WXT, React 19,
              TypeScript and Tailwind CSS.
            </p>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-dim transition-colors hover:border-brand/40 hover:text-ink"
            >
              <Github className="size-3.5" />
              imshaikot/browsentic
            </a>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="font-mono text-[11px] tracking-[0.16em] text-ink-faint uppercase">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...('ext' in l && l.ext
                        ? { target: '_blank', rel: 'noreferrer noopener' }
                        : {})}
                      className="text-sm text-ink-dim transition-colors hover:text-brand"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Rule />
        <div className="flex flex-col items-center justify-between gap-3 pt-6 text-xs text-ink-faint sm:flex-row">
          <p>MIT licensed. Not affiliated with Anthropic.</p>
          <p className="font-mono">{VERSION}</p>
        </div>
      </div>
    </footer>
  )
}
