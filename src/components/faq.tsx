import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus } from 'lucide-react'
import { FAQ as ITEMS } from '@/data/content'
import { Reveal, Section, SectionHeading } from '@/components/primitives'
import { cn } from '@/lib/utils'

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <Section id="faq">
      <SectionHeading kicker="Questions" title="The ones people ask first" align="center" />

      <div className="mx-auto mt-12 max-w-3xl">
        {ITEMS.map((item, i) => {
          const isOpen = open === i
          return (
            <Reveal key={item.q} delay={i * 0.04}>
              <div className="border-b border-line">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start justify-between gap-6 py-5 text-left"
                >
                  <span
                    className={cn(
                      'font-display text-[1.0625rem] font-medium transition-colors sm:text-lg',
                      isOpen ? 'text-ink' : 'text-ink-dim',
                    )}
                  >
                    {item.q}
                  </span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                      isOpen ? 'border-brand/50 text-brand' : 'border-line text-ink-faint',
                    )}
                  >
                    <Plus className="size-3.5" />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pr-12 pb-5 text-[0.9375rem] leading-relaxed text-ink-dim">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          )
        })}
      </div>
    </Section>
  )
}
