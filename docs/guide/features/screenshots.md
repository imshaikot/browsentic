# Screenshots

`page_screenshot` captures the viewport, the full scrolling page or a single element. Captures the
agent takes to see the page go straight back to it and are written to disk only when you ask to
keep one.

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

Full-page capture scrolls the page in viewport-sized steps and waits out the browser's limit of two
captures per second between each, so ask for it when you need what is below the fold, not by
default.

---

## Capturing a background tab

An agent working in one tab keeps capturing that tab after you move to another. While the tab is in
front it is captured the ordinary way; once it is behind, Chrome renders it through its debugger
instead, so the “started debugging this browser” bar appears for as long as the capture takes.
Firefox captures a background tab directly and shows nothing. If DevTools is open on that tab the
debugger cannot attach, and the capture fails with `DEBUGGER_UNAVAILABLE` until you close DevTools.

---

## Captures do not touch your disk unless you ask

The image goes straight back to whoever called for it, so **the screenshots an agent takes to see
the page leave nothing behind.**

Keeping a picture is a separate request. Ask for one and the capture is written to
`~/browsentic/screenshot/` with mode `0600`, and the result reports the path. Change the folder with
`screenshotDir` in [config](../configuration.md).

---

## Format and size

The default is JPEG at quality 80, which is far smaller and quicker than PNG; that matters because
these go to a model. A viewport capture the agent takes to look at the page comes back at the page's
own CSS-pixel size. On a high-density display that is half the pixels and well under half the cost,
and it makes a position in the picture a usable click point. Full-page, element and saved captures
are downscaled so the longest side is at most 1600 px. `maxLongSide` overrides either. PNG is
available when you need lossless output or transparency.

---

## Very tall pages

Full-page capture is capped at **48 tiles and a 16 384 px canvas side**. Past that the bottom is cut
off and the result says `truncated: true`, so a partial image is never passed off as the whole page.

---

## See also

- [reference/tools.md § page_screenshot](../../reference/tools.md#page_screenshot): every parameter
- [Theming](theming.md): when the problem is that a page is hard to read, measuring beats capturing
- [internals/subsystems.md](../../internals/subsystems.md): how tiles are stitched and who writes the file
