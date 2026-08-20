---
name: page-theming
description: Read what the page is actually painting — luminance, palette, design tokens, contrast — and retheme it on its own terms.
triggers: [dark mode, light mode, theme, retheme, colour scheme, color scheme, too bright, too dark, hurts my eyes, easier on the eyes, night mode, contrast, hard to read, unreadable, accessibility, wcag, luminance, brightness, colours, colors, palette, design tokens, make it darker, make it lighter, tone it down, warmer, calmer]
---

You are changing how a page looks, and looks are the one thing you cannot see. Every step here is measured: read the numbers, change the page, read them again.

## 1. Measure first

`page_readTheme` is the snapshot. It reports what is actually painted, not what the stylesheet says:

- `luminance.background` — 0 is black, 1 is white. This is the number the user means by "too bright" or "too dark".
- `colors` and `palette` — the hexes on screen, grouped into surface, text, border and accent, ordered by how much area each covers. The first surface swatch is the page's real background.
- `tokens` — the CSS custom properties resolved at `:root`. On a page built from design tokens these are the theme, and overriding them is the clean way in.
- `scheme.hooks` — dark/light switches the page's **own** stylesheets already define, like a `.dark` class or `[data-theme="dark"]`. A hook means the page has a real theme you can turn on instead of faking one.
- `surfaces.diagram` — a text tree of the coloured regions with each one's luminance and text contrast, so you can see which panel is the odd one out.

`page_auditContrast` is the readability score: the share of visible text runs that pass WCAG, plus the worst offenders with their ratios and selectors. Take it **before** you change anything — it is only meaningful next to the same number afterwards.

## 2. Turn the user's words into a number

The user says "too bright", not "0.05". Translate, then act on the translation:

| They say | You do |
| --- | --- |
| dark mode, night mode, too bright | `mode: "dark"` |
| back to normal, undo that, revert | `mode: "revert"` |
| a bit darker / a bit lighter | `targetLuminance` shifted from the measured one, not a guess |
| washed out, dull, more alive | `saturation` above 1 |
| too loud, calmer, muted | `saturation` below 1 |
| I can't read this | fix the contrast: read the audit, then change the colours the failures name |

For "a bit", move `targetLuminance` by roughly a third of the way to the extreme and re-measure. Two small measured steps beat one large blind one.

## 3. Change it on the page's own terms

`page_applyTheme` tries the least invasive thing that works, in this order, and tells you which one it used in `strategy`:

1. **`stylesheet`** — it switched on the hook the page already ships and set `color-scheme`. Nothing is faked; the page renders its own dark theme. This is the good outcome.
2. **`colors`** — your explicit `background`, `text`, `accent` or `tokens` were applied as overrides.
3. **`filter`** — the page had no dark theme of its own, so the whole document is repainted through a CSS filter. It works everywhere and it has a real cost: `<html>` becomes a containing block, so `position: fixed` headers and modals re-anchor to it and can move. Images are re-inverted so photos stay right way round. Say so if the page visibly shifts.

When `tokens` came back from `page_readTheme`, prefer them. `{"--background": "#0f172a", "--foreground": "#e2e8f0"}` lets the page's own rules do the work and leaves fixed positioning alone — far better than filtering the whole document.

## 4. Confirm it landed

The result carries `before` and `after`, each with the measured background hex, its luminance and the body text contrast — and `reachedTarget` when you asked for a specific luminance. Check them. A filter changes nothing in the CSSOM, so the other tools would normally read straight through it; Browsentic maps every colour it reports through the active filter, which means `page_readTheme` and `page_auditContrast` keep telling the truth after a theme change. Re-run the audit and compare scores.

If `reachedTarget` is false, the page fought back — usually a surface with a hard-coded background. `surfaces.diagram` names it; override its token or set `background` outright.

## 5. Put it back

`page_applyTheme { mode: "revert" }` removes everything Browsentic applied — the injected stylesheet, the class or attribute it set, the filter — and restores whatever the page had before. `reverted: false` means there was nothing to undo.

Two things to remember. A theme **does not survive a reload or a navigation**; if the user navigates and asks why it went away, that is why — reapply it. And applying a theme twice does not stack: each call replaces the last one, so re-applying with adjusted numbers is the right way to iterate.
