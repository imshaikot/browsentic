import { ArrowRight, Github } from 'lucide-react'
import { REPO } from '@/data/content'
import { Button, Glow, Reveal } from '@/components/primitives'
import { CopyCommand } from '@/components/copy-command'

export function Cta() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:px-8 md:py-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-grid mask-radial absolute inset-0" />
        <Glow className="bottom-[-14rem] left-1/2 size-[46rem] -translate-x-1/2" color="var(--color-ember)" opacity={0.15} />
        <Glow className="top-[-10rem] right-[12%] size-[30rem]" color="var(--color-brand)" opacity={0.12} />
      </div>

      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <h2 className="text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.03] font-semibold">
            Stop describing the page.
            <br />
            <span className="text-gradient">Hand it over.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-ink-dim">
            Free and MIT licensed. Nothing to sign up for, no key to paste, and a fresh install
            connects to nothing until you redeem a pairing code yourself.
          </p>
        </Reveal>
        <Reveal delay={0.14}>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="#start" className="w-full sm:w-auto">
              Get started
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Button>
            <Button href={REPO} variant="ghost" external className="w-full sm:w-auto">
              <Github className="size-4" />
              imshaikot/browsentic
            </Button>
          </div>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mx-auto mt-8 max-w-md">
            <CopyCommand command="git clone https://github.com/imshaikot/browsentic.git" />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
