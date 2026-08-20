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

## Captures do not touch your disk unless you ask

This is the part worth knowing. The image is handed straight back to whoever called for it, so
**the screenshots an agent takes to see the page for itself leave nothing behind.**

A picture you want to keep is a different request. Ask for one and the capture is written to
`~/browsentic/screenshot/` at mode `0600`, and the result reports the path.

Change where with `screenshotDir` in [config](../configuration.md).

---

## Format and size

Defaults are JPEG at quality 80, downscaled so the longest side is at most 1600 px — far smaller
and quicker than PNG, which matters because these go to a model. PNG is available when you need
lossless or transparency.

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
