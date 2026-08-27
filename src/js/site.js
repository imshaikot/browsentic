// The only script on the site. Everything it does is progressive: the page is
// complete and navigable with this file blocked.
;(() => {
  'use strict'

  // Nav condenses once the hero has scrolled under it.
  const nav = document.getElementById('sitenav')
  if (nav) {
    const CONDENSED = ['border-b', 'border-line', 'bg-ground/85', 'backdrop-blur-xl']
    let condensed = false
    const onScroll = () => {
      const should = window.scrollY > 24
      if (should === condensed) return
      condensed = should
      nav.classList[should ? 'add' : 'remove'](...CONDENSED)
    }
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // The mobile sheet is a <details>; close it on navigation and on Escape.
  const sheet = document.getElementById('mobilenav')
  if (sheet) {
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('a')) sheet.removeAttribute('open')
    })
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') sheet.removeAttribute('open')
    })
  }

  // Copy buttons. The markup carries the text, so nothing is fetched.
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
      } catch {
        return
      }
      const label = button.querySelector('[data-copy-label]')
      if (!label) return
      const previous = label.textContent
      label.textContent = 'Copied'
      setTimeout(() => (label.textContent = previous), 1600)
    })
  }

  // Highlight the table-of-contents entry for whichever heading is in view.
  const toc = document.getElementById('toc')
  if (toc && 'IntersectionObserver' in window) {
    const links = new Map(
      [...toc.querySelectorAll('a')].map((a) => [decodeURIComponent(a.hash.slice(1)), a]),
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
