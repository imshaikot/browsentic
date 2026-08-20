# Inside the extension

Where an invoke frame actually runs, and how a run stays in its own tab.

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

**[Agent runs →](agent-runs.md)** — Path B, where an instruction becomes a spawned CLI.
