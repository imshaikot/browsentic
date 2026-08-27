---
layout: layouts/doc.njk
pageKey: docs
title: "Theming and contrast"
seoTitle: "Theming and contrast — Browsentic features"
description: "Dark mode on a site that has none, colours toned down, and a real WCAG readability score — all measured rather than guessed."
deck: "Dark mode on a site that has none, colours toned down, and a real WCAG readability score — all measured rather than guessed."
docsPath: "guide/features/theming.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 4
isIndex: false
permalink: "/docs/guide/features/theming/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/theming.md"
---
```
this page is too bright, give me dark mode
make it easier to read
put it back
```

Three tools: `page_readTheme` measures, `page_auditContrast` scores, `page_applyTheme` changes.

---

## It changes the page on the page's own terms

This is the difference between Browsentic and a browser extension that inverts everything.

`page_applyTheme` tries the least invasive thing that works, and reports which one it used:

| Strategy | What happened | Cost |
| --- | --- | --- |
| **`stylesheet`** | It switched on the dark/light hook the page's own stylesheets already define — a `.dark` class, a `[data-theme]` attribute — and set `color-scheme`. The page renders its own dark theme. Nothing is faked | None. The good outcome |
| **`colors`** | Your explicit background, text, accent or design-token overrides were applied | None to speak of |
| **`filter`** | The page had no theme of its own, so the whole document is repainted through a CSS filter | Real — see below |

The filter fallback works everywhere and has a genuine cost: `<html>` becomes a containing block, so
`position: fixed` headers and modals re-anchor to it and can move. Images are re-inverted so photos
stay the right way round.

On a page built from design tokens, overriding the tokens is the clean way in — the page's own
rules do the work, and fixed positioning is left alone. `page_readTheme` reports the tokens
resolved at `:root`, which is where they come from.

---

## What "measured" means

`page_readTheme` reports what is actually painted, not what the stylesheet claims:

| | |
| --- | --- |
| `luminance.background` | 0 is black, 1 is white. This is the number behind "too bright" |
| `palette` | The hexes on screen, grouped into surface, text, border and accent, ordered by how much area each covers |
| `tokens` | The CSS custom properties resolved at `:root` |
| `scheme.hooks` | Dark/light switches the page's **own** stylesheets define. A hook means there is a real theme to turn on |
| `surfaces.diagram` | A text tree of the coloured regions with each one's luminance and text contrast — so the panel that is the odd one out is visible |

`page_auditContrast` walks the visible text, resolves each run's foreground against the real
background painted behind it — blending translucent layers up the ancestor chain — and reports the
ratio, what the level requires, and whether it passes. The score is the share of sampled text runs
that pass, so it is **directly comparable before and after** a change.

AA needs 4.5:1 for body text and 3:1 for large text; AAA needs 7:1 and 4.5:1.

Every `page_applyTheme` result carries `before` and `after` — measured background hex, luminance,
and body text contrast — so a change can be checked rather than assumed.

### Measurements stay true after a filter

A CSS filter changes nothing in the CSSOM, so the other tools would normally read straight through
it and report the old colours. Browsentic maps every colour it reports through the active filter,
which means `page_readTheme` and `page_auditContrast` keep telling the truth after a theme change.

---

## Iterating

"A bit darker" is a measured step, not a guess: the luminance moves roughly a third of the way to
the extreme and gets re-measured. Two small measured steps beat one large blind one.

Applying a theme twice does not stack — each call replaces the last one, so re-applying with
adjusted numbers is the right way to converge.

---

## Putting it back

```
put it back
```

`mode: "revert"` removes everything Browsentic applied — the injected stylesheet, the class or
attribute it set, the filter — and restores whatever the page had before.

**A theme does not survive a reload or a navigation.** If you navigate and the page comes back
bright, that is why. Ask again.

---

## See also

- [reference/tools.md](/docs/reference/tools/) — `page_readTheme`, `page_auditContrast`, `page_applyTheme` parameters
- [Skills](/docs/guide/features/skills/) — the `page-theming` skill is what routes these requests
- [Limits](/docs/guide/limits/#themes-do-not-survive-a-reload)
