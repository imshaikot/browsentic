# Theming and contrast

Browsentic can switch a page to dark mode, tone its colours down and score its text contrast against
WCAG, measuring the colours actually painted before and after every change.

```
this page is too bright, give me dark mode
make it easier to read
put it back
```

Three tools: `page_readTheme` measures, `page_auditContrast` scores, `page_applyTheme` changes.

---

## How a theme is applied

`page_applyTheme` tries the least invasive method that works, and reports which one it used.
Repainting the whole page is the last resort:

| Strategy | What happened | Cost |
| --- | --- | --- |
| **`stylesheet`** | It switched on the dark/light hook the page's own stylesheets already define (a `.dark` class, a `[data-theme]` attribute) and set `color-scheme`. The page renders its own dark theme; nothing is faked | None. The best outcome |
| **`colors`** | Your explicit background, text, accent or design-token overrides were applied | None to speak of |
| **`filter`** | The page had no theme of its own, so the whole document is repainted through a CSS filter | Real; see below |

The filter fallback works everywhere and has a real cost: `<html>` becomes a containing block, so
`position: fixed` headers and modals re-anchor to it and can move. Images are re-inverted so photos
stay the right way round.

On a page built from design tokens, overriding the tokens is the clean approach: the page's own
rules do the work, and fixed positioning is left alone. `page_readTheme` reports the tokens resolved
at `:root`, which is where they come from.

---

## What "measured" means

`page_readTheme` reports what is actually painted, not what the stylesheet claims:

| | |
| --- | --- |
| `luminance.background` | 0 is black, 1 is white. This is the number behind "too bright" |
| `palette` | The hexes on screen, grouped into surface, text, border and accent, ordered by how much area each covers |
| `tokens` | The CSS custom properties resolved at `:root` |
| `scheme.hooks` | Dark/light switches the page's **own** stylesheets define. A hook means there is a real theme to turn on |
| `surfaces.diagram` | A text tree of the coloured regions with each one's luminance and text contrast, which shows the panel that is the odd one out |

`page_auditContrast` walks the visible text, resolves each run's foreground against the background
actually painted behind it (blending translucent layers up the ancestor chain), and reports the
ratio, what the level requires, and whether it passes. The score is the share of sampled text runs
that pass, so it is **directly comparable before and after** a change.

AA needs 4.5:1 for body text and 3:1 for large text; AAA needs 7:1 and 4.5:1.

Every `page_applyTheme` result carries `before` and `after` (measured background hex, luminance and
body text contrast), so a change can be checked instead of assumed.

### Measurements stay true after a filter

A CSS filter changes nothing in the CSSOM, so the other tools would normally read straight through
it and report the old colours. Browsentic maps every colour it reports through the active filter,
so `page_readTheme` and `page_auditContrast` stay accurate after a theme change.

---

## Iterating

"A bit darker" is a measured step: the luminance moves roughly a third of the way to the extreme
and is measured again. Two small measured steps beat one large blind one.

Applying a theme twice does not stack. Each call replaces the last one, so re-applying with adjusted
numbers is how to converge.

---

## Putting it back

```
put it back
```

`mode: "revert"` removes everything Browsentic applied (the injected stylesheet, the class or
attribute it set, the filter) and restores whatever the page had before.

**A theme does not survive a reload or a navigation.** If the page comes back bright after you
navigate, ask again.

---

## See also

- [reference/tools.md](../../reference/tools.md): `page_readTheme`, `page_auditContrast`, `page_applyTheme` parameters
- [Skills](skills.md): the `page-theming` skill routes these requests
- [Limits](../limits.md#themes-do-not-survive-a-reload)
