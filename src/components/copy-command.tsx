import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CopyCommand({
  command,
  prefix = '$',
  className,
}: {
  command: string
  prefix?: string | null
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Blocked clipboard: the text stays on screen and selectable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy: ${command}`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border border-line bg-ground-2/60 px-4 py-3 text-left backdrop-blur transition-colors hover:border-brand/40 hover:bg-surface/50',
        className,
      )}
    >
      {prefix && <span className="font-mono text-sm text-brand/70 select-none">{prefix}</span>}
      <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-ink">{command}</code>
      <span className="relative size-4 shrink-0 text-ink-faint transition-colors group-hover:text-brand">
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="done"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0"
            >
              <Check className="size-4 text-lime" />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0"
            >
              <Copy className="size-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  )
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* selectable on screen either way */
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-ground/70">
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute top-2.5 right-2.5 z-10 rounded-md border border-line bg-ground-2/80 p-1.5 text-ink-faint opacity-0 backdrop-blur transition-all group-hover:opacity-100 hover:text-brand focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-lime" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-4 pr-12">
        <code className="font-mono text-[12.5px] leading-relaxed text-ink">
          {code.split('\n').map((line) => {
            const [cmd, ...rest] = line.split('#')
            return (
              <span key={line} className="block whitespace-pre">
                {lang === 'sh' && cmd.trim() && <span className="text-brand/60">$ </span>}
                <span>{cmd.replace(/\s+$/, '')}</span>
                {rest.length > 0 && (
                  <span className="text-ink-faint">  #{rest.join('#')}</span>
                )}
              </span>
            )
          })}
        </code>
      </pre>
    </div>
  )
}
