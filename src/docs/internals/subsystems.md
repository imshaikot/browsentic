---
layout: layouts/doc.njk
pageKey: docs
title: "Subsystems"
seoTitle: "Subsystems — Browsentic internals"
description: "The things that are more than a single action. src/lib/monitor/, src/lib/bridge/monitor.ts"
deck: "The things that are more than a single action."
docsPath: "internals/subsystems.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 7
isIndex: false
permalink: "/docs/internals/subsystems/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/subsystems.md"
---
![Five of the subsystems, each as its own short pipeline](/docs/assets/subsystems.png)

---

## Monitors

[`src/lib/monitor/`](https://github.com/imshaikot/browsentic/tree/main/src/lib/monitor/), [`src/lib/bridge/monitor.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/bridge/monitor.ts)

Watch a pinned tab in the background for a completion condition — an element appearing or vanishing,
text or title matching a regex, a progress bar reaching a threshold.

| | |
| --- | --- |
| Concurrent | 3 (`MAX_MONITORS`) |
| Duration | 30 minutes default, 4 hours maximum |
| Stall warning | After 2 minutes with no change |
| `page_awaitMonitor` poll | 10 minutes maximum per call |

Percent and ETA are extrapolated from the sample history. Completion fires a browser notification; an
MCP client can also long-poll with `page_awaitMonitor`.

Sampling is debounced and rate-limited, with a **five-second backstop tick** so a page that stops
mutating still gets checked.

The watch lives in the extension, so it survives the agent finishing, the MCP client disconnecting,
and the daemon going away.

---

## Diagnostics

[`src/lib/diagnostics/`](https://github.com/imshaikot/browsentic/tree/main/src/lib/diagnostics/), [`src/lib/bridge/diagnostics.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/bridge/diagnostics.ts)

The only debugger attach that outlives the action which opened it. `withDebugger` in
[`cdp.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/bridge/cdp.ts) attaches, runs one action and detaches in a `finally` —
correct for a click, useless for "what errored?", because `Runtime.consoleAPICalled` and
`Network.responseReceived` arrive only while attached.

| | |
| --- | --- |
| Concurrent | 2 (`MAX_SESSIONS`), one per tab |
| Duration | 5 minutes default, 30 maximum, 30 s minimum (Chrome's alarm floor) |
| Console ring | 500 entries |
| Network ring | 1,000 requests |
| Per-entry cap | 2,000 chars; headers 30 × 400 chars |

Holding a session open means owning every way it has to close, since nothing else will: the explicit
`page.stopDiagnostics`, the timeout alarm, the end of the side-panel run that opened it, the tab
closing, and Chrome's own `onDetach` when DevTools takes the session. A recording started by an
external MCP client has no run to end with, so the timeout is its only ceiling.

Events land in in-memory rings behind a **debounced write** to `storage.session`, because a chatty
SPA produces thousands of them and the service worker can die between any two. Evictions are counted
and reported with every read.

Nothing here sanitizes. `invokeForHarness` seals every result on its way out, and a `Cookie` header,
a bearer token and a token in a query string are ordinary strings in an ordinary result object by
then. What this subsystem owns is what is ever *returned*: headers only when asked for, bodies only
when the [`network-body-read`](/docs/internals/guardrails/) rule has let the call through.

---

## Recordings

[`src/lib/recordings/`](https://github.com/imshaikot/browsentic/tree/main/src/lib/recordings/)

The reverse of a monitor: the content script observes what *you* do in one pinned tab — clicks,
fills, selects, keys, submits, scrolls, navigations — and batches the events to the background.

| | |
| --- | --- |
| Duration | 15 minutes (`MAX_RECORDING_MS`), warning at 13 (`WARN_AT_MS`) |
| Events | 2 000 (`MAX_EVENTS`) |
| Steps kept | 80, capped at 12 KB of prompt (`MAX_WORKFLOW_BYTES`) |
| Variables | 20 |

**Scrubbing is unconditional.** Passwords, hidden fields, one-time codes and Luhn-valid card numbers
are dropped whatever the settings. Typed values become `{{placeholders}}` unless "Save what I type"
is on. Captured text, selectors and values are each truncated to a fixed length.

On stop, a one-shot [`task`-mode](/docs/internals/guardrails/#two-spawn-modes) agent call turns the raw trace into
ordered, named steps. That call cannot reach the browser — `{"mcpServers":{}}` is asserted in its
argv.

Recordings live in **extension storage, not on disk**, which is why `browsentic skills` does not
list them and why `page_listRecordings` / `page_readRecording` exist as tools.

---

## Site maps

[`src/lib/skills/site-map.ts`](https://github.com/imshaikot/browsentic/blob/main/src/lib/skills/site-map.ts),
[`src/daemon/agent/site-map-store.ts`](https://github.com/imshaikot/browsentic/blob/main/src/daemon/agent/site-map-store.ts)

Generated skills. A mapping run crawls one host read-only under the
[mapping gate](/docs/internals/guardrails/#the-mapping-gate) and finishes by calling `browsentic_saveSiteMap`
exactly once.

The report is validated against per-field size limits, then written to a `.staging/` directory the
skill loader **deliberately cannot read** — an unreviewed map is not merely unused, it is never
opened.

The panel shows the markdown as plain text with the domain it will match. **Activate** commits it;
**Discard** deletes it. An abandoned run's staging is swept.

---

## Files

Attached in the side panel, stored in the extension, and summarised by a one-shot `task`-mode agent
call at attach time.

The agent never opens a file. It sees the notes, plus `page_attachFile { fileId, target }` to put one
into a file input. Upload is `confirm` under the `file-upload` rule.

---

## Screenshots

Full-page mode stitches `captureVisibleTab` tiles, paced by the browser's two-captures-per-second
limit.

Capped at **48 tiles and a 16 384 px canvas side**, reporting `truncated: true` when the page was
taller than the limit rather than silently returning a partial image.

The daemon, not the browser, writes the file — and only when `save: true` was passed or a mapping run
supplied a `saveTo`. See [request-path.md](/docs/internals/request-path/#details-worth-knowing).

---

## Next

**[State on disk →](/docs/internals/state/)**
