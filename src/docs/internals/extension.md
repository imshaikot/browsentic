---
layout: layouts/doc.njk
pageKey: docs
title: "Inside the extension"
seoTitle: "Inside the extension — Browsentic internals"
description: "Where an invoke frame actually runs, and how a run stays in its own tab. Not every capability can run in the page. The background service worker splits them:"
deck: "Where an invoke frame actually runs, and how a run stays in its own tab."
docsPath: "internals/extension.md"
section: "internals"
sectionLabel: "Internals"
sectionOrder: 4
order: 4
isIndex: false
permalink: "/docs/internals/extension/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/internals/extension.md"
---
![Where an invoke frame runs: the background/content split, and the self-healing injection](/docs/assets/extension.png)

---

## Background vs content script

Not every capability can run in the page. The background service worker splits them:

| Handled entirely in the background | Why |
| --- | --- |
| `listFiles`, `attachFile`, `listRecordings`, `readRecording` | The data lives in extension storage |
| `startMonitor`, `monitorStatus`, `awaitMonitor`, `stopMonitor` | Monitors outlive any single page |
| `openTab`, `switchTab`, `closeTab`, `screenshot`, `navigate` | Need the `tabs`/`scripting` APIs |
| Everything else | Forwarded to the content script |

## Self-healing injection

The forwarding call is `invokeInTab()`. A tab that loaded *before* the extension did has no content
script, so `tabs.sendMessage` fails with `Receiving end does not exist`. The extension then injects
the content script via `browser.scripting.executeScript` and:

- for the four idempotent reads (`getPageInfo`, `extractText`, `waitForElement`, `navigate`) it
  **retries immediately**;
- for anything that *changes* the page it returns `TAB_UNREACHABLE` with instructions to re-snapshot
  first — because the caller's selectors were computed against a page it has not actually seen.

`onInstalled` also sweeps every open, non-discarded tab and injects there, so a fresh install does
not leave you with a browser full of unreachable tabs.

Pages that refuse content scripts at all (`chrome://`, the Web Store, the new-tab page) stay
`TAB_UNREACHABLE` permanently. `page_navigate` still works there through the tabs API, which is why
it is the documented escape hatch.

---

## The panel's tabs

`PanelNav` owns the tab strip: **Chat**, **History**, **Skills**, **Recordings**, **Settings**.
Adding one is a variant in `PanelTab`, an entry in `TABS`, and a branch in the side panel's body —
there is no router.

**The strip labels as much as it can afford.** A `ResizeObserver` measures the width the labelled
row actually needs and steps through three fits: every label, then only the open tab's, then icons
alone with a dot where the count chip was. A width is only knowable while it is on screen, so each
fit records its own and steps one rung down; stepping back up waits for the width it already
learned, which is what keeps the strip from flapping between two fits at one panel width. In
practice five labels want ~485 px and one wants ~225 px, so a side panel at its usual size lands on
the middle fit.

**Settings** is the only tab whose state lives on the daemon rather than in extension storage. It
reads and writes `~/.browsentic/config.json` through two bridge ops, `guardrails` and
`setGuardrail`, which forward to the socket frames of the same name. The extension holds no copy:
every write returns the daemon's fresh view, which is what the panel then renders.

## Minimizing: the rail lives in the page

**Nothing can resize a side panel.** `chrome.sidePanel` offers `open`, `close`, `setOptions` and
`getLayout`, and `PanelLayout` carries only `side` — the width is the user's, dragged and remembered
by Chrome. So collapsing the panel *into* itself would only leave an empty column. Minimizing
instead **closes the panel and draws a 44 px rail into the page**, which is a surface the extension
can size.

| | |
| --- | --- |
| `src/lib/rail/events.ts` | The channel, the `RailView` the background computes, the tab list with its Lucide paths copied out, and the palette spelled in `oklch` |
| `src/lib/rail/host.ts` | `exposeRail()` in the content script — builds the rail in a **closed** shadow root on `documentElement` |
| `src/lib/bridge/rail.ts` | `serveRail()` and `syncRail()` in the background — what to paint, and when |
| `src/lib/bridge/panel-view.ts` | `browsentic/panelCollapsed` and `browsentic/panelTab`, read by `use-panel-view.ts` in the panel |

The content script carries no React and no icon package, which is why the paths and colours are
copied rather than imported — `src/extension/components/` would drag the whole panel bundle onto every page.

**A closed shadow root on `documentElement` is load-bearing.** It keeps the rail out of
`body.innerText` (so `extractText` never returns it), out of the page's `querySelectorAll`, and out
of any page stylesheet. The host element has no layout footprint; the rail inside it is
`position: fixed`, centred on the panel's own side, inset from the edge so it never covers the
page's scrollbar.

**The click is the gesture.** `sidePanel.open()` needs user activation, and the only activation the
panel will ever get is the click on the rail, forwarded from the content script. `serveRail()`
spends it before any `await` — a single statement, no storage read in front of it. It deliberately
does *not* clear the collapsed flag: the panel clears it itself on mount with the `panelOpened`
bridge op, so an `open()` that gets refused leaves the rail on screen rather than dropping the user
into nothing.

**`syncRail()` broadcasts to every tab** instead of tracking which tabs carry a rail. That is a
service-worker decision, not laziness: a `Set` of painted tabs comes back empty when the worker is
revived, which would strand a rail on a page with no way to clear it. The first sync of a worker's
life always broadcasts; only a repeated *clear* is skipped. A tab that has just finished loading is
repainted on its own rather than triggering a broadcast.

Pages that refuse content scripts — `chrome://`, the Web Store, the new-tab page — get no rail.
That is the same `TAB_UNREACHABLE` set as everywhere else, and it is why the toolbar icon and the
**Open Browsentic** context-menu item stay the guaranteed way back in.

## Tab scoping

A panel conversation is **bound to the tab it started in**.

The background keeps a registry of tab sessions in `browser.storage.session` under
`browsentic/tabSessions`. Each entry maps a `sessionId` to:

- its main tab,
- the subtabs its runs opened,
- the tab its next action should land on,
- the live tab title,
- the run currently going in it, if any.

Every frame the daemon sends for an agent run carries that run's `runId`, and the extension resolves
it to the owning session's current tab. So a run keeps working in its own tab while the user browses
somewhere else, and two sessions in two tabs act independently.

| Situation | Behaviour |
| --- | --- |
| A run opens a tab with `page.openTab` | Adopted as a subtab of the same session |
| `page.switchTab` onto a tab another session owns | Refused with `TAB_IN_USE` |
| Every tab of a session is gone | Its actions fail with `SESSION_TAB_CLOSED` |
| A ninth session is opened | `SESSION_LIMIT` — the cap is 8 |

Calls with no run behind them — an external MCP client, the local fast path — still target the
**active tab of the current window**.

A site-mapping run keeps its own older pin, threading a literal `tabId` and failing with
`MAPPING_TAB_CHANGED` if that tab goes away.

### Lifecycle

Closing a tab ends its session: the run is cancelled, the transcript is flushed to history, and the
entry leaves the registry.

Closing the side panel does **not** — the tab is the anchor. While a run is going, its tab carries a
dot on the toolbar badge and on its favicon.

---

## Next

**[Agent runs →](/docs/internals/agent-runs/)** — Path B, where an instruction becomes a spawned CLI.
