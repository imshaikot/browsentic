---
layout: layouts/doc.njk
pageKey: docs
title: "Background monitoring"
seoTitle: "Background monitoring — Browsentic features"
description: "Long jobs — an upload, a build, a deploy — do not need an agent sitting on them burning tokens on \"is it done yet\". Browsentic finds the progress signal…"
deck: "Long jobs — an upload, a build, a deploy — do not need an agent sitting on them burning tokens on \"is it done yet\"."
docsPath: "guide/features/monitoring.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 6
isIndex: false
permalink: "/docs/guide/features/monitoring/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/monitoring.md"
---
```
watch this upload and tell me when it's done
```

---

## What happens

Browsentic finds the progress signal, pins the tab, and watches it **in the background while you
work elsewhere**. It tracks percent, extrapolates an ETA from the sample history, notices when
progress has stalled, and notifies you on completion.

The watch runs in the extension. It needs no further tool calls, and it keeps running even if the
agent finishes, the MCP client disconnects, or the daemon goes away.

---

## What it can watch for

| Condition | Completes when |
| --- | --- |
| `element-appears` | An element shows up |
| `element-vanishes` | An element goes away — a spinner, usually |
| `text-matches` | Page text matches a regular expression |
| `title-matches` | The tab title matches one |
| `progress-reaches` | A progress bar hits a threshold (100 by default) |

`page_findProgress` is what picks the signal: it scans for progress bars with their current percent,
percent readouts in text, spinners and busy regions, each with a selector. If it comes back empty,
the page shows nothing measurable — and you will be asked what completion looks like rather than
given a watch on nothing.

---

## Limits

| | |
| --- | --- |
| Concurrent monitors | 3 |
| Default duration | 30 minutes |
| Maximum duration | 4 hours |
| While it runs | The tab is pinned; you can work anywhere else |
| On completion | A browser notification, plus the run's own report |

Sampling is debounced and rate-limited, with a five-second backstop tick so a page that stops
mutating still gets checked.

---

## Stopping one

```
stop monitoring
```

That is an [instant command](/docs/guide/features/instant-commands/) — it ends the watch without waking an agent at
all. The tab is unpinned again and no notification is shown, since the stop was asked for.

---

## From an MCP client

`page_awaitMonitor` long-polls a monitor to completion. A reply with `settled: false` means the poll
window passed while the watch continues — **call again**; that is normal, not an error. If the call
fails with `EXTENSION_OFFLINE`, the monitor is still running in the browser: reconnect and call
again.

---

## See also

- [reference/tools.md § Monitoring](/docs/reference/tools/#monitoring) — every parameter
- [Scheduling](/docs/guide/features/scheduling/) — when the page shows nothing to watch and the job must be re-done
- [Skills](/docs/guide/features/skills/) — the `monitor-progress` skill routes these requests
- [internals/subsystems.md](/docs/internals/subsystems/) — how sampling actually works
