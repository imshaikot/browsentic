# Screenshots

```
take a screenshot of this page and save it
```

---

## Three kinds of capture

| | What you get | Cost |
| --- | --- | --- |
| **Viewport** (default) | What is on screen right now | A single grab, well under a second |
| **Full page** | The entire scroll view, stitched from viewport tiles | Roughly a second per screenful |
| **One element** | Just that element's box | A single grab |

Full-page capture has to scroll the page in viewport-sized steps and wait out the browser's
two-captures-per-second limit between each. Ask for it when you need what is below the fold, not
by default.

---

## A capture follows the tab, not your eyes

An agent working in one tab keeps photographing that tab after you move to another. While the tab
is in front it is captured the ordinary way; once it is behind, Chrome renders it through its
debugger instead, so the “started debugging this browser” bar appears for the moment the capture
takes. Firefox captures a background tab directly and shows nothing. If DevTools is open on that
tab the debugger cannot attach, and the capture fails with `DEBUGGER_UNAVAILABLE` until you close
it.

---

## Captures do not touch your disk unless you ask

This is the part worth knowing. The image is handed straight back to whoever called for it, so
**the screenshots an agent takes to see the page for itself leave nothing behind.**

A picture you want to keep is a different request. Ask for one and the capture is written to
`~/browsentic/screenshot/` at mode `0600`, and the result reports the path.

Change where with `screenshotDir` in [config](../configuration.md).

---

## Format and size

Defaults are JPEG at quality 80 — far smaller and quicker than PNG, which matters because these go
to a model. A viewport capture the agent takes to look at the page comes back at the page's own
CSS-pixel size, which on a high-density display is half the pixels and well under half the cost,
and makes a position in the picture a usable click point. Full-page, element and saved captures
are downscaled so the longest side is at most 1600 px. `maxLongSide` overrides either. PNG is
available when you need lossless or transparency.

---

## Very tall pages

Full-page capture is capped at **48 tiles and a 16 384 px canvas side**. Beyond that the bottom is
cut off and the result says `truncated: true`, rather than silently returning a partial image and
letting you believe it is the whole thing.

---

## See also

- [reference/tools.md § page_screenshot](../../reference/tools.md#page_screenshot) — every parameter
- [Theming](theming.md) — if the goal is "this page is unreadable", measuring beats capturing
- [internals/subsystems.md](../../internals/subsystems.md) — how tiles are stitched and who writes the file
