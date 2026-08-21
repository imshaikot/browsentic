import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { Github, Menu, X } from 'lucide-react'
import { NAV_LINKS, REPO, VERSION } from '@/data/content'
import { Wordmark } from '@/components/logo'
import { cn } from '@/lib/utils'

export function Nav() {
  const [condensed, setCondensed] = useState(false)
  const [open, setOpen] = useState(false)
  const { scrollY } = useScroll()

  useMotionValueEvent(scrollY, 'change', (y) => setCondensed(y > 24))

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <motion.header
        initial={{ y: -70, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
      >
        <nav
          className={cn(
            'mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-full px-3 py-2 transition-all duration-500 sm:px-4',
            condensed
              ? 'border border-line bg-ground/78 shadow-[0_10px_40px_-16px_rgb(0_0_0/0.85)] backdrop-blur-xl'
              : 'border border-transparent bg-transparent',
          )}
        >
          <a href="#top" className="shrink-0 pl-1" aria-label="Browsentic, back to top">
            <Wordmark />
          </a>

          <ul className="hidden items-center gap-1 xl:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-full px-3 py-2 text-sm text-ink-dim transition-colors hover:bg-surface/60 hover:text-ink"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[11px] text-ink-faint sm:block">{VERSION}</span>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-all hover:border-brand/45 hover:bg-surface/60"
            >
              <Github className="size-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-ink xl:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </nav>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 bg-ground/96 px-6 pt-28 backdrop-blur-xl xl:hidden"
          >
            <ul className="flex flex-col gap-1">
              {NAV_LINKS.map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + i * 0.05, duration: 0.4 }}
                >
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block border-b border-line py-4 font-display text-2xl font-medium text-ink"
                  >
                    {l.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
