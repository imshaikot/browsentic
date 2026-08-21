import { motion, useScroll, useSpring } from 'motion/react'
import { Nav } from '@/components/nav'
import { Hero } from '@/components/hero'
import { Stats } from '@/components/stats'
import { Pipeline } from '@/components/pipeline'
import { Capabilities } from '@/components/capabilities'
import { Orchestration } from '@/components/orchestration'
import { Automations } from '@/components/automations'
import { Teach } from '@/components/teach'
import { Mcp } from '@/components/mcp'
import { Security } from '@/components/security'
import { QuickStart } from '@/components/quickstart'
import { Faq } from '@/components/faq'
import { Cta } from '@/components/cta'
import { Footer } from '@/components/footer'
import { Rule } from '@/components/primitives'

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const width = useSpring(scrollYProgress, { stiffness: 320, damping: 40, restDelta: 0.001 })

  return (
    <motion.div
      aria-hidden
      style={{ scaleX: width }}
      className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gradient-to-r from-brand via-brand to-ember"
    />
  )
}

export default function App() {
  return (
    <>
      <ScrollProgress />
      <a
        href="#how"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[70] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:text-ground"
      >
        Skip to content
      </a>

      <Nav />

      <main>
        <Hero />
        <Stats />
        <Pipeline />
        <Rule className="mx-auto max-w-6xl" />
        <Capabilities />
        <Rule className="mx-auto max-w-6xl" />
        <Orchestration />
        <Rule className="mx-auto max-w-6xl" />
        <Automations />
        <Rule className="mx-auto max-w-6xl" />
        <Teach />
        <Rule className="mx-auto max-w-6xl" />
        <Mcp />
        <Security />
        <Rule className="mx-auto max-w-6xl" />
        <QuickStart />
        <Faq />
        <Cta />
      </main>

      <Footer />
    </>
  )
}
