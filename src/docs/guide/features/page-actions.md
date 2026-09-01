---
layout: layouts/doc.njk
pageKey: docs
title: "Page actions"
seoTitle: "Page actions — Browsentic features"
description: "The 49 things Browsentic can do to a page. You never have to name these — you say what you want and the agent picks — but knowing what exists tells you what…"
deck: "The 49 things Browsentic can do to a page. You never have to name these — you say what you want and the agent picks — but knowing what exists tells you what is worth asking for."
docsPath: "guide/features/page-actions.md"
section: "guide/features"
sectionLabel: "Features"
sectionOrder: 2
order: 2
isIndex: false
permalink: "/docs/guide/features/page-actions/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/guide/features/page-actions.md"
---
Exact parameters for every one: [reference/tools.md](/docs/reference/tools/).

---

## How targeting works

Most actions take a target described by **CSS selector, visible text, ARIA role or index**.

`page_getPageInfo` returns an inventory of links, buttons, fields and forms with a **stable selector
already computed** for each — so the agent uses those rather than guessing. Better still, targeting
by **visible text** survives redesigns that break CSS paths.

---

## Reading

| | |
| --- | --- |
| `page_getPageInfo` | The workhorse. Document metadata, viewport and scroll state, a semantic layout tree with a text diagram, the heading outline, and an inventory of every interactive element — each with its selector, its ARIA role, its live state (disabled, checked, expanded, filled, `aria-current`) and the landmark region it sits in |
| `page_extractText` | Rendered text of an element or the whole page, a sentence-aligned group at a time — long pages come back through a cursor rather than truncated. Raw HTML is [denied by default](/docs/guide/approvals/) |
| `page_waitForElement` | Wait until an element is attached, visible, hidden or detached |
| `page_findProgress` | Scan for progress signals worth [monitoring](/docs/guide/features/monitoring/) |
| `page_findSearch` | Report whether this site has a search of its own, where its box is, and the URL a search lands on |
| `page_pickElement` | Hand the page over and let the user point at the element they mean. See [A-Eye](/docs/guide/features/a-eye/) |
| `page_screenshot` | See [Screenshots](/docs/guide/features/screenshots/) |

## Clicking and typing

| | |
| --- | --- |
| `page_clickElement` | Clicks like a user, firing the full pointer and mouse sequence |
| `page_trustedClick` | A real browser-level click — `isTrusted` is true, dispatched through Chrome's debugger rather than from the page. The pointer travels to the target and dwells before pressing, so widgets that sample pointer movement get the sequence they wait for. For the handful of pages that reject synthetic clicks, and the browser features only a genuine gesture unlocks |
| `page_hoverElement` | Triggers menus, tooltips and hover states |
| `page_dragElement` | Drag one element onto another, or to a point |
| `page_focusInput` | Focus and place the caret, or select all |
| `page_fillInput` | Set a value in an input, textarea or contenteditable |
| `page_typeText` | Streams text one keystroke at a time at a human pace — a real key event per character, varying pauses, longer breaths after punctuation. For pages that *watch* you type |
| `page_selectOption` | Choose a `<select>` option by value, label or position |
| `page_selectText` | Select text by element or exact phrase |
| `page_pressKey` | A key press with optional modifiers |
| `page_submitForm` | Submit a form, firing its validation as if you pressed Enter. [Gated by default](/docs/guide/approvals/) |
| `page_highlightElement` | A temporary outline overlay with an optional caption — for showing you what it found |

## Moving around

| | |
| --- | --- |
| `page_searchSite` | Search this site with its own search, by its search URL or its search box, and land on the results |
| `page_navigate` | Go to a URL, or back / forward / reload |
| `page_scrollTo` | To an element, an absolute position, or by one viewport |
| `page_openTab` | Open a URL in a new tab, which becomes the target for later actions unless `active: false` |
| `page_switchTab` | Bring another tab to the front. With no arguments it *lists* the open tabs and their ids |
| `page_closeTab` | Close a tab and report which one the browser moved to |

Tab tools are the only ones that change *which* tab everything else acts on, and they are scoped to
the current window. `closeTab` refuses deliberately in four cases: the only tab in a window, a
pinned tab, a browser page, and a tab being [recorded](/docs/guide/features/recordings/).

## Repeating a job, and doing what no tool covers

Two tools exist for the cases the fixed toolset handles badly. When the same sequence is about to
run twenty times with only the input changing — creating twenty tags, archiving every row — twenty
rounds of wait, find, click and verify is slow and fragile. And some things no tool covers at all:
seeking a video to a timestamp, reading pixels off a canvas, driving an editor's own API.

**Both are off unless you switch them on.** The composer has a **Live tool** switch — the `</>` button
beside the message box — and it starts off. With it off the agent cannot reach these tools at all,
is not told they exist, and gets `LIVE_TOOLS_OFF` if it tries; nothing but your own click turns it
on. With it on, the agent decides whether the job actually warrants a script.

`page_injectCode` then asks to install a small toolkit of JavaScript functions in the page. **You
review the source and approve it** — the prompt in the side panel has a **Review** button that opens
the full code before you decide. `page_runCode` calls one of those functions with fresh arguments,
as often as the job needs, without asking again.

What you approve is that code, on that tab, on that site. Later calls can only reach the functions
you read; only their arguments change. There is no "always on this site" for an injection, because
that would authorise code you never saw. Navigate to another site and the toolkit stops working
rather than following you.

The agent is told to reach for this only when a task repeats three or more times or when nothing
else can do the job — a one-off click is cheaper as a click. See [Approvals](/docs/guide/approvals/) and
[reference/tools.md](/docs/reference/tools/#scripting).

## Everything else

| Group | Tools | See |
| --- | --- | --- |
| Theming and accessibility | `page_readTheme`, `page_auditContrast`, `page_applyTheme` | [Theming](/docs/guide/features/theming/) |
| Captchas | `page_findCaptcha`, `page_solveCaptcha` | [Captchas](/docs/guide/features/captcha/) |
| Diagnostics | `page_startDiagnostics`, `page_readConsole`, `page_readNetwork`, `page_stopDiagnostics` | [Diagnostics](/docs/guide/features/diagnostics/) |
| Background watching | `page_startMonitor`, `page_monitorStatus`, `page_awaitMonitor`, `page_stopMonitor` | [Monitoring](/docs/guide/features/monitoring/) |
| Scheduled jobs | `page_startTimer`, `page_timerStatus`, `page_stopTimer` | [Scheduling](/docs/guide/features/scheduling/) |
| Files | `page_listFiles`, `page_attachFile`, `page_captureDownload`, `page_listDownloads` | [Files](/docs/guide/features/files/) |
| Recordings | `page_listRecordings`, `page_readRecording` | [Recordings](/docs/guide/features/recordings/) |

---

## See also

- [reference/tools.md](/docs/reference/tools/) — every parameter
- [Approvals](/docs/guide/approvals/) — which of these pause and ask
- [internals/registry.md](/docs/internals/registry/) — why the tool list can never describe something the browser cannot do
