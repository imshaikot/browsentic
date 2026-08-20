import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowRight, Github, Mic } from 'lucide-react'
import { HERO, REPO, VERSION } from '@/data/content'
import { Button, Glow } from '@/components/primitives'
import { CopyCommand } from '@/components/copy-command'
import { HeroDemo } from '@/components/hero-demo'

export function Hero() {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const demoY = useTransform(scrollY, [0, 700], [0, reduce ? 0 : -46])
  const demoScale = useTransform(scrollY, [0, 700], [1, reduce ? 1 : 0.965])

  return (
    <section id="top" className="relative overflow-hidden px-5 pt-32 pb-20 sm:px-8 sm:pt-40 md:pb-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-grid mask-radial absolute inset-0" />
        <Glow className="-top-40 left-[8%] size-[42rem]" color="var(--color-ember)" opacity={0.13} />
        <Glow className="-top-32 right-[4%] size-[38rem]" color="var(--color-brand)" opacity={0.15} />
        <Glow className="top-[38%] left-[38%] size-[30rem]" color="var(--color-magenta)" opacity={0.07} />
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <motion.a
            href={`${REPO}/releases`}
            target="_blank"
            rel="noreferrer noopener"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2.5 rounded-full border border-line bg-ground-2/60 py-1.5 pr-4 pl-1.5 text-[13px] backdrop-blur transition-colors hover:border-brand/40"
          >
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 font-mono text-[11px] text-brand">
              {VERSION}
            </span>
            <span className="text-ink-dim">{HERO.badge}</span>
            <ArrowRight className="size-3.5 text-ink-faint" />
          </motion.a>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="mt-7 text-[clamp(2.5rem,7vw,4.75rem)] leading-[0.99] font-semibold"
          >
            {HERO.title.lead}
            <br />
            {HERO.title.tail}
            <span className="text-gradient">{HERO.title.accent}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-dim sm:text-lg"
          >
            {HERO.lede}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button href="#start" className="w-full sm:w-auto">
              Get started
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Button>
            <Button href={REPO} variant="ghost" external className="w-full sm:w-auto">
              <Github className="size-4" />
              Star on GitHub
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-8 max-w-md"
          >
            <CopyCommand command={HERO.command} />
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-ink-faint">
              <Mic className="size-3" />
              {HERO.voice}
            </p>
          </motion.div>
        </div>

        {/* A MotionValue on style.y cannot share an element with an animate-driven y. */}
        <motion.div
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 sm:mt-20"
        >
          <motion.div style={{ y: demoY, scale: demoScale }}>
            <HeroDemo />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
