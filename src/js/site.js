// The only script on the site. Everything it does is progressive: the markup is
// complete and readable with this file blocked, and the `js` class that hides
// pre-reveal elements is only set once this has a chance to run.
;(() => {
  'use strict'

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

  /* ---- Nav ------------------------------------------------------------- */

  const nav = document.getElementById('sitenav')
  if (nav) {
    const CONDENSED = ['border-b', 'border-line', 'bg-ground/85', 'backdrop-blur-xl']
    let condensed = false
    const onScroll = () => {
      const should = scrollY > 24
      if (should === condensed) return
      condensed = should
      nav.classList[should ? 'add' : 'remove'](...CONDENSED)
    }
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  const sheet = document.getElementById('mobilenav')
  if (sheet) {
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('a')) sheet.removeAttribute('open')
    })
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') sheet.removeAttribute('open')
    })
  }

  /* ---- Copy buttons ---------------------------------------------------- */

  for (const button of $$('[data-copy]')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
      } catch {
        return
      }
      const label = $('[data-copy-label]', button)
      if (!label) return
      const previous = label.textContent
      label.textContent = 'Copied'
      setTimeout(() => (label.textContent = previous), 1600)
    })
  }

  /* ---- Scroll reveals -------------------------------------------------- */

  const revealed = (el) => el.classList.add('is-in')

  if (reduced || !('IntersectionObserver' in window)) {
    $$('[data-reveal], [data-stagger], .meter').forEach(revealed)
  } else {
    // Index children of a stagger group so CSS can offset each one.
    for (const group of $$('[data-stagger]')) {
      ;[...group.children].forEach((child, i) => child.style.setProperty('--i', i))
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          revealed(entry.target)
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    $$('[data-reveal], [data-stagger], .meter').forEach((el) => observer.observe(el))

    // If anything above ever throws, do not leave the page blank.
    setTimeout(() => $$('[data-reveal]:not(.is-in), [data-stagger]:not(.is-in)').forEach(revealed), 4000)
  }

  /* ---- Count-up -------------------------------------------------------- */

  for (const el of $$('[data-count]')) {
    const target = Number(el.dataset.count)
    if (!Number.isFinite(target)) continue
    if (reduced || !('IntersectionObserver' in window)) {
      el.textContent = String(target)
      continue
    }

    el.textContent = '0'
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const start = performance.now()
        const DURATION = 1100
        const tick = (now) => {
          const t = Math.min(1, (now - start) / DURATION)
          // easeOutExpo, so it lands rather than crawls.
          const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
          el.textContent = String(Math.round(target * eased))
          if (t < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.5 },
    )
    io.observe(el)
  }

  /* ---- Card spotlight -------------------------------------------------- */

  if (!reduced && matchMedia('(hover: hover)').matches) {
    for (const card of $$('.spotlight')) {
      card.addEventListener(
        'pointermove',
        (e) => {
          const r = card.getBoundingClientRect()
          card.style.setProperty('--mx', `${e.clientX - r.left}px`)
          card.style.setProperty('--my', `${e.clientY - r.top}px`)
        },
        { passive: true },
      )
    }
  }

  /* ---- Tabs ------------------------------------------------------------ */

  for (const group of $$('[data-tabs]')) {
    const tabs = $$('[role="tab"]', group)
    const underline = $('.tab-underline', group)

    const move = (tab) => {
      if (!underline) return
      underline.style.width = `${tab.offsetWidth}px`
      underline.style.translate = `${tab.offsetLeft}px 0`
    }

    const select = (tab) => {
      for (const other of tabs) {
        const on = other === tab
        other.setAttribute('aria-selected', String(on))
        other.tabIndex = on ? 0 : -1
        other.classList.toggle('text-ink', on)
        other.classList.toggle('text-ink-faint', !on)
        const panel = document.getElementById(other.getAttribute('aria-controls'))
        if (panel) panel.hidden = !on
      }
      move(tab)
    }

    group.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]')
      if (tab) select(tab)
    })

    group.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement)
      if (i === -1) return
      const next =
        e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
        : null
      if (!next) return
      e.preventDefault()
      next.focus()
      select(next)
    })

    const initial = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0]
    if (initial) select(initial)
    addEventListener('resize', () => {
      const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
      if (current) move(current)
    })
  }

  /* ---- Hero demo ------------------------------------------------------- */

  // The transcript is rendered server-side in full. This hides it and replays
  // it, so a crawler reads every step and a visitor watches it happen.
  const demo = $('[data-demo]')
  if (demo && !reduced) {
    const promptEl = $('[data-demo-prompt]', demo)
    const steps = $$('[data-step]', demo)
    const cursor = $('[data-demo-cursor]', demo)
    const stage = $('[data-demo-stage]', demo)
    const prompt = promptEl?.dataset.text ?? ''
    const timers = []

    const at = (fn, ms) => timers.push(setTimeout(fn, ms))
    const clearAll = () => {
      timers.splice(0).forEach(clearTimeout)
    }

    const focusTarget = (name) => {
      for (const el of $$('[data-target]', demo)) {
        el.toggleAttribute('data-focused', Boolean(name) && el.dataset.target === name)
      }
      if (!cursor || !stage) return
      const target = name && $(`[data-target="${name}"]`, demo)
      if (!target) {
        cursor.style.opacity = '0'
        return
      }
      const a = target.getBoundingClientRect()
      const b = stage.getBoundingClientRect()
      cursor.style.opacity = '1'
      cursor.style.translate = `${a.left - b.left + a.width - 10}px ${a.top - b.top + a.height - 8}px`
    }

    const run = () => {
      clearAll()
      steps.forEach((s) => (s.hidden = true))
      focusTarget(null)
      if (promptEl) promptEl.textContent = ''

      let t = 500
      for (let i = 1; i <= prompt.length; i++) {
        at(() => promptEl && (promptEl.textContent = prompt.slice(0, i)), t)
        t += 32
      }

      t += 520
      steps.forEach((step) => {
        at(() => {
          step.hidden = false
          focusTarget(step.dataset.focus || null)
        }, t)
        t += Number(step.dataset.ms) || 900
      })

      at(() => focusTarget(null), t)
      at(run, t + 1800)
    }

    // Only run while it is on screen. An off-screen loop is wasted battery.
    let running = false
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible && !running) {
          running = true
          run()
        } else if (!visible && running) {
          running = false
          clearAll()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(demo)

    addEventListener('pagehide', clearAll)
  }

  /* ---- Docs table of contents ------------------------------------------ */

  const toc = document.getElementById('toc')
  if (toc && 'IntersectionObserver' in window) {
    const links = new Map(
      $$('a', toc).map((a) => [decodeURIComponent(a.hash.slice(1)), a]),
    )
    const ACTIVE = ['border-brand', 'text-ink']
    let current = null
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const link = links.get(entry.target.id)
          if (!link || link === current) continue
          current?.classList.remove(...ACTIVE)
          link.classList.add(...ACTIVE)
          current = link
        }
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    )
    for (const id of links.keys()) {
      const heading = document.getElementById(id)
      if (heading) observer.observe(heading)
    }
  }
})()
