import { motion, useReducedMotion, type Variants } from 'motion/react'
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 22 },
  shown: { opacity: 1, y: 0 },
}

export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'span'
}) {
  const reduce = useReducedMotion()
  const Tag = motion[as]

  return (
    <Tag
      className={className}
      variants={reduce ? undefined : revealVariants}
      initial={reduce ? undefined : 'hidden'}
      whileInView={reduce ? undefined : 'shown'}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  )
}

export function Stagger({
  children,
  className,
  gap = 0.07,
}: {
  children: ReactNode
  className?: string
  gap?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? undefined : 'hidden'}
      whileInView={reduce ? undefined : 'shown'}
      viewport={{ once: true, margin: '-70px' }}
      variants={{ shown: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={revealVariants}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function Section({
  id,
  children,
  className,
}: {
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('relative px-5 py-24 sm:px-8 md:py-32', className)}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  )
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-line bg-ground-2/60 px-3 py-1',
        'font-mono text-[11px] tracking-[0.16em] text-ink-dim uppercase',
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
      {children}
    </div>
  )
}

export function SectionHeading({
  kicker,
  title,
  lede,
  align = 'left',
}: {
  kicker: string
  title: string | readonly string[]
  lede?: ReactNode
  align?: 'left' | 'center'
}) {
  const lines = typeof title === 'string' ? [title] : title

  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      <Reveal>
        <Kicker>{kicker}</Kicker>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="mt-5 text-[clamp(1.9rem,4.4vw,3.1rem)] leading-[1.06] font-semibold">
          {lines.map((line, i) => (
            <Fragment key={line}>
              {i > 0 && <br className="hidden sm:block" />}
              {i > 0 ? ` ${line}` : line}
            </Fragment>
          ))}
        </h2>
      </Reveal>
      {lede && (
        <Reveal delay={0.12}>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-ink-dim">{lede}</p>
        </Reveal>
      )}
    </div>
  )
}

export function Button({
  href,
  children,
  variant = 'primary',
  className,
  external,
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'ghost'
  className?: string
  external?: boolean
}) {
  const base =
    'group relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[0.9375rem] font-medium transition-all duration-300 will-change-transform'

  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      className={cn(
        base,
        variant === 'primary' &&
          'bg-brand text-ground shadow-[0_6px_28px_-8px_var(--color-brand)] hover:-translate-y-0.5 hover:shadow-[0_12px_38px_-8px_var(--color-brand)]',
        variant === 'ghost' &&
          'border border-line-strong bg-ground-2/50 text-ink backdrop-blur hover:-translate-y-0.5 hover:border-brand/45 hover:bg-surface/60',
        className,
      )}
    >
      {children}
    </a>
  )
}

export function Glow({
  className,
  color = 'var(--color-brand)',
  opacity = 0.16,
}: {
  className?: string
  color?: string
  opacity?: number
}) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute rounded-full blur-[110px] animate-drift', className)}
      style={{ background: color, opacity }}
    />
  )
}

export function Rule({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'h-px w-full bg-gradient-to-r from-transparent via-line-strong to-transparent',
        className,
      )}
    />
  )
}
