---
layout: layouts/doc.njk
pageKey: docs
title: "MCP tools and actions"
seoTitle: "MCP tools and actions — Browsentic reference"
description: "Every tool Browsentic publishes to an MCP client, the action behind each one, the read-only resources, and the reserved actions that never become tools."
deck: "Every tool Browsentic publishes to an MCP client, the action behind each one, the read-only resources, and the reserved actions that never become tools."
docsPath: "reference/tools.md"
section: "reference"
sectionLabel: "Reference"
sectionOrder: 3
order: 0
isIndex: false
permalink: "/docs/reference/tools/"
sourceUrl: "https://github.com/imshaikot/browsentic/blob/main/docs/reference/tools.md"
---
The page tools are generated from the shared action registry
([src/lib/actions/registry.ts](https://github.com/imshaikot/browsentic/blob/main/src/lib/actions/registry.ts)) — one module per action under
[src/lib/actions/page/](https://github.com/imshaikot/browsentic/tree/main/src/lib/actions/page/), one entry in the registry, and the daemon publishes it.
Because the extension and the MCP server are built from the same registry, a tool can never
describe something the browser cannot do. This page is the human-readable copy; the machine
listing is always `yarn daemon:manifest` (see [Keeping this page honest](#keeping-this-page-honest)).

**Names.** An action is namespaced with dots, a tool with underscores: action `page.fillInput` is
published as tool `page_fillInput`. The mapping is mechanical, so this page names each tool once
and the action is implied. Actions under the reserved `browsentic.` prefix are daemon verbs, not
registry actions — of those, only `browsentic_status` (always) and `browsentic_saveSiteMap`
(mapping runs only) surface as tools.

The surface, at a glance:

| Group | Tools |
| --- | --- |
| [Status](#status) | `browsentic_status` |
| [Reading](#reading) | `page_getPageInfo`, `page_extractText`, `page_waitForElement`, `page_findProgress`, `page_findSearch`, `page_screenshot` |
| [Acting](#acting) | `page_clickElement`, `page_trustedClick`, `page_findCaptcha`, `page_solveCaptcha`, `page_hoverElement`, `page_dragElement`, `page_focusInput`, `page_fillInput`, `page_typeText`, `page_selectOption`, `page_selectText`, `page_pressKey`, `page_submitForm`, `page_highlightElement` |
| [Moving](#moving) | `page_searchSite`, `page_navigate`, `page_scrollTo`, `page_openTab`, `page_switchTab`, `page_closeTab` |
| [Theming](#theming) | `page_readTheme`, `page_auditContrast`, `page_applyTheme` |
| [Diagnostics](#diagnostics) | `page_startDiagnostics`, `page_readConsole`, `page_readNetwork`, `page_stopDiagnostics` |
| [Monitoring](#monitoring) | `page_startMonitor`, `page_monitorStatus`, `page_awaitMonitor`, `page_stopMonitor` |
| [Scheduling](#scheduling) | `page_startTimer`, `page_timerStatus`, `page_stopTimer` |
| [Files](#files) | `page_listFiles`, `page_attachFile`, `page_captureDownload`, `page_listDownloads` |
| [Recordings](#recordings) | `page_listRecordings`, `page_readRecording` |
| [Mapping runs only](#mapping-runs-only) | `browsentic_saveSiteMap` |
| [Resources](#resources) | `browsentic://page/diagram`, `browsentic://page/current`, `browsentic://page/text` |

Every page tool acts on the active tab; only the [tab tools](#moving) change which tab that is.
In the parameter tables below, the **Default** column reads `required` when the parameter must be
given and `—` when it is optional with no default.

---

## Element targets

Most tools that touch an element take a `target` object. Prefer the selectors `page_getPageInfo`
hands back over guessing; better still, target by visible `text` — it survives redesigns that
break CSS paths. Every field is optional, but a useful target sets at least one of `selector` or
`text`.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `selector` | string | — | CSS selector for the element |
| `text` | string | — | Case-insensitive visible text the element should contain |
| `role` | string | — | Tag name or ARIA role to narrow matches, e.g. `"button"` or `"link"` |
| `nth` | integer | `0` | Zero-based index when several elements match |

Below, a parameter typed *[target](#element-targets)* is exactly this object.

---

## Status

### browsentic_status

Report whether the Browsentic browser extension is connected, its version, and the active tab —
plus any running monitors, and a `hint` naming the fix when something is wrong. Call it first when
a page tool fails. No parameters.

---

## Reading

### page_getPageInfo

Snapshot the current page: document metadata, viewport and scroll state, a semantic layout tree
with a text diagram, the heading outline, and an inventory of interactive elements — each with a
stable selector already computed. The workhorse; start here.

Every element in the inventory carries three things beyond its selector, so you can decide what to
touch without a second call:

| Field | What it tells you |
| --- | --- |
| `role` | The computed ARIA role — `link`, `button`, `textbox`, `combobox`, `checkbox`, `tab`, whatever the page declares. The same vocabulary the `role` field of a [target](#element-targets) accepts. |
| `state` | Only the keys that apply: `disabled`, `checked`, `expanded`, `selected`, `required`, `invalid`, `current` (from `aria-current`, which marks the page you are on), `filled` for text inputs, and `value` for the selected option of a `<select>`. Field contents are never reported — `filled` says whether something is typed, not what. |
| `region` | The landmark it lives in, e.g. `navigation “Primary”` or `form “Checkout”`. Use it to tell the main content's “Delete” from the sidebar's. |

Elements hidden from assistive technology — anything inside `aria-hidden="true"` or `inert` — are
left out of the tree, the outline and the inventory. Each region in the diagram is annotated with
how many links, buttons and fields its subtree holds, and `interactive.counts` reports the true
totals before `maxPerKind` truncates the lists.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxPerKind` | integer | `30` | Cap on links, buttons, fields, and forms listed per kind |

### page_extractText

Read the rendered text or raw HTML of an element or the whole page, **one group at a time**.

A group is as much text as fits in `maxLength`, cut back to the last paragraph break or sentence
end inside that budget — so a reply never stops mid-sentence, and the same text always groups the
same way. When more remains the reply carries a `cursor`; pass it back to get the next group, and
keep going until no cursor comes back. A first call with no `cursor` behaves exactly as it always
did, so a caller that only wants the top of the page can ignore all of this.

The cursor is `<offset>.<digest>`, where the digest covers **the text already delivered**. Every
resume re-derives that digest from the live page and compares. Two consequences worth knowing:

- A page that only **grows** — infinite scroll, an appended log, lazily rendered sections — does not
  invalidate anything. The part you have read is unchanged, so the read continues seamlessly.
- A page that **rewrote** what you already read returns `{"stale": true, "source", "length"}` and no
  content at all, rather than stitching two versions of the document together. Read again with no
  cursor. This is the whole reply, deliberately: a restart should cost a sentence, not 20,000
  characters of text the caller may no longer want.

A `cursor` that was not handed out by this tool is refused with `INVALID_INPUT`; offsets cannot be
hand-rolled, because the digest would not match.

`format: "html"` is denied by default: outerHTML carries comments, `aria-hidden` nodes and
off-screen text, which is where a page hides instructions meant for the model rather than
the reader. Rendered text is what a person actually sees. Set `"raw-html-read": "allow"`
under `guardrails.rules` in `~/.browsentic/config.json` if a run genuinely needs markup.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Element to read; defaults to the whole page |
| `format` | `"text"` \| `"html"` | `"text"` | Rendered text, or raw HTML when policy allows it |
| `maxLength` | integer | `20000` | Characters per group, capped at 200,000. The reply stops at the last boundary that fits, so it comes back a little shorter |
| `cursor` | string | — | Continue a read: the cursor the previous reply returned. Omit to start from the top |

| Result field | When | What it is |
| --- | --- | --- |
| `content` | every group | The group's text, trimmed of trailing whitespace |
| `source` | always | CSS path of the element that was read |
| `length` | always | Characters in the full text, not just this group |
| `offset` | every group | Where this group starts in that full text |
| `truncated` | every group | `true` when more text remains |
| `nextOffset`, `cursor` | more remains | Where the next group starts, and the cursor that fetches it |
| `stale` | the page was rewritten | `true`, with no `content` — start over with no cursor |

### page_waitForElement

Wait until an element reaches a state: attached, visible, hidden, or detached.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | Element to wait for |
| `state` | `"attached"` \| `"visible"` \| `"hidden"` \| `"detached"` | `"visible"` | State to wait for: present in the DOM, present and visible, invisible or absent, or absent |
| `timeoutMs` | integer | `5000` | Give up after this many milliseconds |

### page_findProgress

Scan the page for progress signals worth monitoring — progress bars, percent readouts, spinners
and busy regions — each with a selector ready for `page_startMonitor`. An empty candidates list
with no `titlePercent` means the page shows nothing measurable: ask the user what completion looks
like instead of starting a monitor.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxCandidates` | integer | `10` | Cap on candidates returned, strongest signals first |

### page_findSearch

Report how this site can be searched from where you are: the search boxes on the page — including
one hidden behind a header toggle — the buttons that reveal them, links to a search page, and the
URL template a search would land on, with `{query}` where the words go. Read-only: it never types
and never navigates.

`searchable: false` with empty lists is the honest answer that this site has no search of its own.
`template` comes from the site's own GET search form where there is one (`templateFrom: "form"`),
otherwise from the current address when it already carries a search parameter
(`templateFrom: "address"`), which is how a re-search keeps the filters you are looking at. A field
reported with `hidden: true` is in the DOM but not on screen — click the `toggles` entry first.

It is one of the read-only actions a [site-mapping run](#mapping-runs-only) may call, so a map can
record where a site's search lives. `page_searchSite` is not — it navigates.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxPerKind` | integer | `5` | Cap on search boxes, toggles and links listed per kind, most likely first |

### page_pickElement

Hand the page to the user and let them point at one element — **A-Eye**. Their cursor becomes a
lens, whatever they hover is outlined, and the element they click comes back as a
[described element](#element-targets) plus its rendered text.

It stops everything and waits for a person, so it costs more than any other tool here: reach for it
only when a target is genuinely ambiguous and pointing is quicker than describing. `hint` is the
question you would otherwise have asked, shown in one line over the page.

The pick is invisible to the site. Every pointer event in the sequence is stopped before the page
sees it and the click itself is cancelled, so picking a link never also follows it. `↑` widens the
pick to the parent element, `Esc` cancels.

Two terminal refusals: `PICK_CANCELLED` when the user dismisses it without choosing, `TIMEOUT` when
they never got to it. Both mean ask in words instead.

The user can also point *first*, from the A-Eye button in the side panel — then no tool call is
involved at all and the element arrives in the run's system prompt. See
[A-Eye](/docs/guide/features/a-eye/).

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `hint` | string | — | One line shown over the page saying what to point at, e.g. "Point at the price you mean". Max 120 characters |
| `maxContentLength` | integer | `2000` | Characters of the element's rendered text to return; past that it is cut and `truncated` comes back true |
| `timeoutMs` | integer | `60000` | Give up after this many milliseconds. 5000–300000 |

### page_screenshot

Capture the tab as a JPEG or PNG — the current viewport, the full scroll view, or a single
targeted element. The image comes back in the result either way; nothing is written to disk unless
you pass `save: true`, which puts it under `~/browsentic/screenshot/` and reports the path as
`savedTo`. Captures an agent takes to see the page for itself therefore leave no files behind.

The default is a single viewport grab, which returns in well under a second. `fullPage: true` has
to scroll the page in viewport-sized steps and wait out the browser's two-captures-per-second limit
between each, so it costs roughly a second per screenful; ask for it when you need what is below
the fold rather than by default.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Capture only this element's box. When set, `fullPage` is ignored |
| `fullPage` | boolean | `false` | With no target: `false` captures the current viewport, `true` the entire scroll view by tiling |
| `format` | `"png"` \| `"jpeg"` | `"jpeg"` | JPEG is far smaller and quicker to encode; PNG is lossless and keeps transparency |
| `quality` | integer | `80` | JPEG quality, 1–100. Only valid when format is `"jpeg"` |
| `maxLongSide` | integer | `1600` | Downscale so the longest side is at most this many pixels |
| `save` | boolean | `false` | Write the image to disk (done by the daemon, which adds `savedTo`). Set it only when the user wants a file to keep |
| `filename` | string | — | Base filename when saving; defaults to `screenshot-<timestamp>.<ext>`. Sanitized before use |

---

## Acting

### page_clickElement

Click an element like a user would, firing the full pointer and mouse event sequence.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | Element to click |
| `scrollIntoView` | boolean | `true` | Bring the element into view before clicking |

### page_trustedClick

Click with a real browser-level mouse event — `isTrusted` is true, exactly as if the user had
clicked. Reach for it only when `page_clickElement` was ignored: pages that check
`event.isTrusted`, and the browser features that only a genuine gesture unlocks — native file
pickers, fullscreen, clipboard reads, popups, WebAuthn prompts.

The pointer is not teleported. It is moved to the target over `moveSteps` interpolated
`mouseMoved` events, dwells for `hoverMs`, and holds the button down for `holdMs` before
releasing — the sequence a real pointer produces, and the one that widgets sampling pointer
movement (drag handles, hover menus, canvas tools, captcha checkboxes) wait for.

Give it either a `target` or a raw viewport `point`. The `point` form exists for things no
selector can reach — inside a cross-origin iframe or a closed shadow root — and is what
[`page_findCaptcha`](#page_findcaptcha) reports.

The click is dispatched through Chrome's debugger rather than from the page, so the browser shows a
"Browsentic is debugging this browser" bar for the duration, the tool fails with
`DEBUGGER_UNAVAILABLE` on a tab that already has DevTools attached, and it is `UNSUPPORTED` on
Firefox. The extension resolves the click point *after* attaching, so the bar's own reflow is
accounted for, and refuses with `INVALID_TARGET` when something covers that point rather than
clicking whatever is on top. The result adds `trusted: true` and the viewport `point` that was
clicked.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Element to click. Give this or `point`, never both |
| `point` | `{ x, y }` | — | Exact viewport coordinates in CSS pixels, for a target no selector can reach |
| `button` | `"left"` \| `"right"` \| `"middle"` | `"left"` | Mouse button to press |
| `clickCount` | integer 1–3 | `1` | 1 for a single click, 2 for a double click, 3 for a triple click |
| `modifiers` | array of `"ctrl"` \| `"shift"` \| `"alt"` \| `"meta"` | `[]` | Modifier keys held during the click, e.g. `["meta"]` to open a link in a new tab |
| `scrollIntoView` | boolean | `true` | Bring the element into view before clicking. Ignored with `point` |
| `moveSteps` | integer 1–60 | `8` | Pointer move events dispatched along the way in |
| `hoverMs` | integer 0–2000 | `60` | Pause on the target after arriving, before pressing |
| `holdMs` | integer 0–2000 | `50` | How long the button stays down between press and release |

### page_findCaptcha

Report what captcha is on the page, without touching it. Ordinary targeting cannot see one:
vendors build the widget as a closed shadow root holding a cross-origin iframe holding another
shadow root, so `page_getPageInfo` shows nothing where the checkbox visibly is. This reads through
all of it with Chrome's debugger.

Recognises Cloudflare Turnstile (including the full-page interstitial), reCAPTCHA v2 and v3,
hCaptcha, GeeTest, Arkose FunCaptcha and AWS WAF. Takes no parameters.

| Result field | Type | Meaning |
| --- | --- | --- |
| `found` | boolean | Whether any known captcha is on the page |
| `vendor`, `label` | string | Which one, e.g. `turnstile` / "Cloudflare Turnstile" |
| `kind` | `"checkbox"` \| `"interactive"` \| `"invisible"` | What the widget asks for |
| `state` | `"idle"` \| `"pending"` \| `"solved"` \| `"needsHuman"` \| `"invisible"` | Where it has got to |
| `solved`, `hasToken` | boolean | Whether it is satisfied, and whether the response field is filled |
| `bounds` | `{ x, y, width, height }` | The widget's box in viewport coordinates, for a screenshot |
| `point` | `{ x, y }` | Where its checkbox is, composed across the frame boundary. Absent when there is nothing to click |
| `note` | string | Why, when there is no `point` or the state needs explaining |

Read-only, so it is allowed during a site-mapping run.

### page_solveCaptcha

Tick a captcha's "I am a human" checkbox with a real browser-level click and wait for the widget to
settle. The checkbox only responds to genuine pointer input, which is the point of it, so no
synthetic click reaches it.

**Confirm-gated.** Ticking another site's human check is the user's decision; an external MCP
client with no approval channel gets `DECLINED` under the default `unattended` policy.

When the vendor escalates to a challenge a person has to answer — an image grid, Arkose, AWS WAF —
it returns `state: "needsHuman"` with the widget `bounds` and **does not attempt the challenge**.
Screenshot that region, tell the user, and poll `page_findCaptcha` until they have solved it.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `waitMs` | integer 0–120000 | `20000` | How long to wait after clicking for the widget to report a verdict |
| `timeoutMs` | integer 1000–180000 | `60000` | Overall budget for the attempt, including finding the widget |

Returns the same fields as `page_findCaptcha`, plus `clicked`. Fails with `CAPTCHA_NOT_FOUND` when
there is no widget to act on.

### page_hoverElement

Hover an element to trigger menus, tooltips, and other hover states.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | Element to hover |
| `scrollIntoView` | boolean | `true` | Bring the element into view first |

### page_dragElement

Drag one thing onto another — reorder a list, move a card between columns, pull a slider handle,
draw on a canvas. Both ends must be on screen at once; nothing auto-scrolls mid-drag.

The web has two unrelated drag mechanisms, and `mode: "auto"` picks between them by reading the
grabbed element. `"pointer"` presses, moves and releases a pointer, which is what dnd-kit,
react-beautiful-dnd, Sortable's fallback mode, sliders and canvases listen for. `"native"` fires the
HTML5 `dragstart`/`dragover`/`drop` sequence with a `DataTransfer`, which is what an element
carrying `draggable="true"` expects. Auto reads that attribute off the element you grab.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `from` | [target](#element-targets) | one of | Element to pick up — the card, row, or drag handle |
| `fromPoint` | `{ x, y }` | one of | Viewport coordinates to grab from, when the grip is not an element |
| `to` | [target](#element-targets) | one of | Element to drop onto |
| `toPoint` | `{ x, y }` | one of | Viewport coordinates to drop at — empty space, a slider position, a canvas spot |
| `mode` | `"auto"` \| `"pointer"` \| `"native"` | `"auto"` | Which drag mechanism to use |
| `steps` | integer 2–60 | `16` | Moves dispatched along the way to the drop point |
| `holdMs` | integer 0–5000 | `120` | How long the button stays down before the drag starts moving |
| `settleMs` | integer 0–5000 | `120` | Pause on the drop point before releasing |
| `trusted` | boolean | `false` | Dispatch real browser-level mouse events. Pointer mode only, Chrome only |
| `scrollIntoView` | boolean | `true` | Bring the grabbed element into view first |

Returns `from` and `to` element summaries, the `grip` and `drop` points it used, the `mechanism`
it chose, and `landedOn` — the selector actually under the pointer at release. Native drags also
return `started` (the source accepted `dragstart`) and `accepted` (some element under the path
called `preventDefault` on `dragover`, which is how a real drop zone signals it will take the drop).
`accepted: false` with nothing moved means the page wants the other mode.

The drop point is measured before the drag starts, so a list that reflows as the pointer passes over
it can land a slot out — raise `steps` and `settleMs`, then read `landedOn` back.

`trusted: true` routes through Chrome's debugger like [page_trustedClick](#page_trustedclick), with
the same costs: the debugging bar appears, DevTools must be closed, and Firefox is unsupported. It
cannot drive HTML5 drag-and-drop, so it is refused with `INVALID_INPUT` when the mechanism resolves
to `native`.

### page_focusInput

Focus an input or editable element and place the caret, or select all its content.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | The input, textarea, or editable element to focus |
| `caret` | `"start"` \| `"end"` \| `"all"` | `"end"` | Where to leave the caret, or select all content |

### page_fillInput

Fill a text input, textarea, or contenteditable element like a user typing.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | Element to type into |
| `value` | string | required | Text to enter |
| `clear` | boolean | `true` | Replace existing content instead of appending |
| `pressEnter` | boolean | `false` | Press Enter afterwards, which submits many forms |

### page_typeText

Stream text into a field one keystroke at a time, at a human pace — a real key event per
character, pauses that vary, longer breaths after punctuation. Use `page_fillInput` when you just
need the value in the field; use this when the page should watch someone type.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Element to type into; defaults to the currently focused element |
| `text` | string | required | Text to type, character by character |
| `speed` | `"slow"` \| `"natural"` \| `"fast"` \| `"instant"` | `"natural"` | `"slow"` ≈ 30 wpm, `"natural"` ≈ 55 wpm, `"fast"` ≈ 110 wpm, `"instant"` fires keystrokes back to back |
| `charDelayMs` | integer | — | Average milliseconds between keystrokes; overrides `speed` when given |
| `jitter` | number | `0.35` | How much each pause varies at random, as a fraction of it — 0 is an even machine rhythm, 1 wildly uneven |
| `clear` | boolean | `true` | Replace existing content instead of appending |
| `pressEnter` | boolean | `false` | Press Enter afterwards, which submits many forms |

### page_selectOption

Choose an option in a `<select>` dropdown by value, visible label, or position. Give exactly one
of `value`, `label`, or `index`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | The select element |
| `value` | string | — | Match by option value |
| `label` | string | — | Match by visible option text, case-insensitive |
| `index` | integer | — | Match by option position |

### page_selectText

Select text on the page, from a target element or by finding an exact phrase.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Element whose entire text content to select |
| `search` | string | — | Exact text to find and select, case-insensitive |
| `occurrence` | integer | `0` | Which match to select when the text appears multiple times |

### page_pressKey

Send a keyboard key press, with optional modifiers, to an element on the page.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `key` | string | required | DOM `KeyboardEvent.key` value, e.g. `"Enter"`, `"Escape"`, `"ArrowDown"`, `"a"` |
| `modifiers` | string[] | `[]` | Modifier keys held during the press |
| `target` | [target](#element-targets) | — | Element to receive the key; defaults to the currently focused element |

### page_submitForm

Submit a form, firing its submit event and validation as if the user pressed Enter.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | The form, or any element inside it; defaults to the first form on the page |

### page_highlightElement

Visually highlight an element with a temporary outline overlay and optional caption — for showing
the user what was found.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | required | Element to highlight |
| `durationMs` | integer | `2000` | How long the highlight stays visible |
| `label` | string | — | Small caption rendered above the highlight |

---

## Moving

### page_searchSite

Search the site you are on, using that site's own search rather than a web search engine. It works
out how this site searches and does it in one call: `strategy: "auto"` goes straight to the URL the
site's search form would land on when one can be derived — which skips the autocomplete overlay
entirely — and types into the search box when it cannot.

It stays on the current site. If this site hands its search to another host the call is refused with
`UNSUPPORTED` naming the URL, so that navigation goes through `page_navigate` and the guardrails
that judge it. `query` is capped at 200 characters: this is a search box, not a channel for sending
a site a payload.

The result reports `via` (`"url"` or `"field"`), `landedOn` — the tab's URL once the search settled,
which is how you confirm it ran — and `loaded`. It does **not** read the results: snapshot with
`page_getPageInfo` or `page_extractText` afterwards. Two refusals name their own fix: a hidden
search box names the toggle to click first, and a page with no search at all points at
`page_findSearch`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `query` | string | required | What to look for on this site. 1–200 characters |
| `strategy` | `"auto"` \| `"url"` \| `"field"` | `"auto"` | `"url"` insists on the search URL, `"field"` insists on typing — which is what a box that filters as you type needs |
| `target` | [target](#element-targets) | — | The search box to use, when the page has several or the one picked was wrong |

### page_navigate

Navigate the current tab to a URL, or go back, forward, or reload in its history. Give one of
`url` or `action`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `url` | string | — | Absolute or relative URL to open (http/https only) |
| `action` | `"back"` \| `"forward"` \| `"reload"` | — | History navigation instead of opening a URL |

### page_scrollTo

Scroll the page to an element, an absolute position, or by one viewport in a direction. Give one
of `target`, `position`, or `direction`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Element to bring into view |
| `position` | object | — | Absolute document coordinates: `x` (default `0`) and `y` (required) |
| `direction` | `"up"` \| `"down"` \| `"top"` \| `"bottom"` | — | Scroll one viewport up or down, or jump to an edge |
| `behavior` | `"smooth"` \| `"instant"` | `"smooth"` | Animation of the scroll |

### page_openTab

Open a URL in a new browser tab. The new tab becomes the one every later page action targets,
unless `active` is `false`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `url` | string | required | Absolute or relative URL to open in the new tab (http/https only) |
| `active` | boolean | `true` | Bring the new tab to the front. Set `false` to open it in the background and leave the current tab in front |

### page_switchTab

Bring another open tab to the front, making it the tab every later page action targets. Call it
with no arguments to list the open tabs and their ids first.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `tabId` | integer | — | Id of the tab to switch to, as reported by `page_openTab` or a no-argument `page_switchTab` |
| `match` | string | — | Instead of an id, switch to the tab whose title or URL contains this text (case-insensitive). If several tabs match, nothing is switched and the candidates are listed |

### page_closeTab

Close an open tab. With no arguments it closes the tab page actions are currently targeting, and
later actions follow the browser to whichever tab it brings to the front.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `tabId` | integer | — | Id of the tab to close, as reported by `page_openTab` or a no-argument `page_switchTab` |
| `match` | string | — | Instead of an id, close the tab whose title or URL contains this text (case-insensitive). If several tabs match, nothing is closed and the candidates are listed |

---

## Theming

Measure what the page is painting, score its readability, and change it. `page_readTheme` before
`page_applyTheme` — the hooks and tokens it reports are what makes a theme change land on the page's
own terms rather than by filtering it. `page_auditContrast` is comparable before and after, so it is
how a change is checked rather than assumed.

Nothing here survives a reload or a navigation.

### page_readTheme

Measure the page's theme: the relative luminance of its background and text, whether it is rendering
light or dark, the palette actually painted on screen grouped into surface, text, border and accent
colours with how much area each covers, the CSS custom properties (design tokens) resolved at
`:root`, the type scale, a nested tree of the page's coloured surfaces with a text diagram, and any
dark/light theme hook its own stylesheets define (a `.dark` class or a `[data-theme]` attribute).

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxScan` | integer | `1200` | Elements to measure, max 4000; a larger document is sampled at an even stride across it |
| `maxPerGroup` | integer | `8` | Colours listed per palette group, max 30, widest coverage first |
| `maxTokens` | integer | `40` | CSS custom properties listed, max 200, sorted by name; `0` skips them |
| `maxSurfaces` | integer | `20` | Coloured surfaces kept in the surface tree, max 60, largest region first |

### page_auditContrast

Score the readability of the page against WCAG contrast rules. Walks the visible text, resolves each
run's foreground against the real background painted behind it — blending translucent layers up the
ancestor chain — and reports the ratio, the ratio the level requires, and whether it passes. The
score is the share of sampled text runs that pass.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | Subtree to audit; defaults to the whole page |
| `level` | `"AA"` \| `"AAA"` | `"AA"` | AA needs 4.5:1 for body text and 3:1 for large text; AAA needs 7:1 and 4.5:1 |
| `maxSamples` | integer | `400` | Text-bearing elements to check, max 2000, in document order |
| `maxFailures` | integer | `20` | Failures listed, max 200, worst ratio first. The counts always cover everything sampled |

### page_applyTheme

Retheme the page, or put it back. Prefers the page's own terms — it switches on the dark/light hook
its stylesheets already define, sets `color-scheme`, and overrides the design tokens you name. Only
when that leaves the page at the wrong luminance does it fall back to repainting through a CSS
filter. Reports the measured background luminance and text contrast before and after.

The result names the `strategy` it used: `stylesheet` (the page's own theme), `colors` (your
overrides), or `filter`. The filter fallback creates a containing block on `<html>`, which re-anchors
`position: fixed` elements, and re-inverts images so photos stay right way round.

Calls do not stack — each replaces the last, so re-applying with adjusted numbers is how to iterate.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `mode` | `"keep"` \| `"dark"` \| `"light"` \| `"revert"` | `"keep"` | `dark`/`light` retheme it, `revert` removes everything Browsentic applied, `keep` leaves the light/dark decision alone and applies only the colours below |
| `targetLuminance` | number | — | Relative luminance to bring the background to, 0–1, as reported by `page_readTheme`. Overrides the luminance a mode implies. Reached by filtering, so it repaints images and text alike |
| `background` | string | — | CSS colour for the page background, e.g. `"#0f172a"`. Suppresses the luminance a mode would imply |
| `text` | string | — | CSS colour for body text; elements that set their own colour keep it |
| `accent` | string | — | CSS colour for links and form-control accents |
| `tokens` | object | — | CSS custom properties to override on `:root`, e.g. `{"--background": "#0f172a"}`. Names come from `page_readTheme`. The cleanest way to retheme a token-based page, because its own rules do the work |
| `saturation` | number | — | Colour intensity multiplier, 0–3: `0` greyscale, `1` unchanged, above `1` more vivid |
| `contrast` | number | — | Contrast multiplier, 0–3: `1` unchanged, above `1` pushes lights and darks apart |
| `transitionMs` | integer | `200` | Cross-fade duration, max 2000; `0` switches instantly |

---

## Diagnostics

What the page **reports** rather than what it renders: `page_startDiagnostics` attaches Chrome's
debugger and starts buffering, `page_readConsole` and `page_readNetwork` read the buffers, and
`page_stopDiagnostics` detaches. Chrome only — all four return `UNSUPPORTED` on Firefox.

Console and network events are delivered only while attached and are not kept anywhere otherwise, so
**start the recording before the thing you are diagnosing happens**. Chrome shows a "Browsentic is
debugging this browser" bar for as long as one runs; it detaches on its own at the timeout, when the
side-panel turn that started it ends, or when the tab closes. See
[Diagnostics](/docs/guide/features/diagnostics/) for the whole shape.

### page_startDiagnostics

Start recording a tab's console messages, uncaught exceptions and requests. Returns a
`diagnosticsId`.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `capture` | array of `"console"` \| `"network"` | `["console","network"]` | What to record. Narrow it to one when the other would only add noise |
| `reload` | boolean | `false` | Reload the page once recording has started, so errors thrown during load are caught |
| `tabId` | integer | — | Tab to record, from `page_openTab` or `page_switchTab`. Defaults to the active tab |
| `timeoutMs` | integer | `300000` | Detach on its own after this long. Minimum 30 s, maximum 30 min |

### page_readConsole

Read the console messages and uncaught exceptions collected so far — level, text, the file and line
that logged it, and a stack for errors. Newest last. Each entry carries a `kind` of `console`,
`exception` or `browser` (Chrome's own reports: CSP violations, mixed content, resources that failed
to load).

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `contains` | string | — | Case-insensitive substring the message must contain |
| `diagnosticsId` | string | — | Which recording to read. Omit when only one is running |
| `drain` | boolean | `false` | Forget the messages returned, so the next call reports only what happened since |
| `level` | `"all"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` | `"all"` | Lowest level to report |
| `limit` | integer | `50` | Most recent messages to return once the filters have been applied |

### page_readNetwork

Read the requests the tab has made — method, URL, status, resource type, timing, size, and the
browser's error text for the ones that failed. Newest last.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `diagnosticsId` | string | — | Which recording to read. Omit when only one is running |
| `drain` | boolean | `false` | Forget the requests returned, so the next call reports only what happened since |
| `includeBodies` | boolean | `false` | Fetch response bodies, truncated, for the 5 most recent requests returned. **Denied by the `network-body-read` rule** unless the user allows it, and only available while the recording is still attached |
| `includeHeaders` | boolean | `false` | Include request and response headers |
| `limit` | integer | `50` | Most recent requests to return once the filters have been applied |
| `method` | string | — | Only requests with this HTTP method, e.g. `"POST"` |
| `status` | `"all"` \| `"problems"` \| `"failed"` \| `"pending"` | `"all"` | `"problems"` is anything that failed or came back 4xx/5xx; `"pending"` is requests with no response yet |
| `urlContains` | string | — | Case-insensitive substring the URL must contain, e.g. `"/api/"` |

Both reads report `droppedConsole` / `droppedNetwork`: the rings hold 500 console entries and 1,000
requests, and a non-zero count means older entries were evicted.

### page_stopDiagnostics

Detach the debugger and take Chrome's bar away. What was collected stays readable afterwards —
response bodies do not, since Chrome keeps those only while attached.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `diagnosticsId` | string | — | Omit when only one recording is running; with several running, an omitted id stops nothing and the candidates are listed |

---

## Monitoring

The background-watch lifecycle: `page_findProgress` picks a signal, `page_startMonitor` starts the
watch, `page_monitorStatus` checks on it, `page_awaitMonitor` blocks for it, `page_stopMonitor`
ends it early. The watch runs in the extension, so it needs no further tool calls and keeps
running even if the MCP client — or the daemon itself — disconnects.

### page_startMonitor

Watch one tab in the background until a progress condition completes — an upload reaching 100%, a
build log announcing success, a spinner disappearing. Returns a `monitorId` immediately; the
extension pins the tab, keeps watching even while the user works elsewhere, and notifies them on
completion. Call `page_findProgress` first to pick a real signal.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `until` | object | required | The condition that completes the watch (fields below) |
| `until.kind` | `"element-appears"` \| `"element-vanishes"` \| `"text-matches"` \| `"progress-reaches"` \| `"title-matches"` | required | What ends the watch |
| `until.target` | [target](#element-targets) | — | Element to watch — required for `element-appears`, `element-vanishes` and `progress-reaches`; optional scope for `text-matches` |
| `until.pattern` | string | — | Case-insensitive regular expression — required for `text-matches` and `title-matches`, e.g. `"upload complete\|processing finished"` |
| `until.threshold` | number | `100` | For `progress-reaches`: completes when progress reaches this percent |
| `label` | string | — | Short name shown in the side panel and the completion notification, e.g. `"YouTube upload"` |
| `tabId` | integer | — | Tab to watch, from `page_openTab` or `page_switchTab`. Defaults to the active tab |
| `timeoutMs` | integer | `1800000` | Give up and report a timeout after this long |

### page_monitorStatus

Report on background monitors started with `page_startMonitor`: phase, percent, ETA, how long
since anything changed, and the latest log lines.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `monitorId` | string | — | One monitor to report. Omit to list every active and recently finished monitor |

### page_awaitMonitor

Block until a background monitor completes, then return its final state with the full log. A reply
with `settled: false` means the timeout passed while the watch continues — call again to keep
waiting; that is normal, not an error. If the call fails with `EXTENSION_OFFLINE` the monitor is
still running in the browser — reconnect and call again.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `monitorId` | string | required | The monitor to wait on, from `page_startMonitor` |
| `timeoutMs` | integer | `120000` | Return after this long even if unfinished — the reply then has `settled: false` and the current state |

### page_stopMonitor

Stop a background monitor before it completes. The tab is unpinned again if the monitor pinned it.
No notification is shown — the stop was asked for.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `monitorId` | string | — | Omit when only one monitor is running; with several running, an omitted id stops nothing and the candidates are listed |

---

## Scheduling

Work on a clock rather than on a condition: `page_startTimer` schedules it, `page_timerStatus`
reports on it, `page_stopTimer` cancels it. The schedule is kept by the extension, so it needs no
further tool calls — when a timer fires it starts a fresh turn in the conversation that set it,
carrying the `prompt` as the instruction. Use a [monitor](#monitoring) instead whenever the page
itself can signal completion; a timer is for work that has to be re-done, such as reloading a queue.

### page_startTimer

Schedule work for later — "in ten minutes check whether the build finished", "every two minutes
refresh the queue". Returns a `timerId` immediately.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `prompt` | string | required | What to do when the timer fires, written as an instruction to the agent starting a fresh turn. With `deliver: "notify"` it is the notification text instead |
| `afterMs` | integer | required | How long to wait before firing, and for a repeating timer the gap between fires. Floor 30000, ceiling 86400000 |
| `repeat` | boolean | `false` | Keep firing every `afterMs` instead of once |
| `maxRuns` | integer | `12` | Stop a repeating timer after this many fires. Ignored when `repeat` is false |
| `label` | string | — | Short name shown in the side panel and in notifications, e.g. `"deploy check"` |
| `deliver` | `"agent"` \| `"notify"` | `"agent"` | `agent` wakes the conversation with the prompt; `notify` only shows the user a browser notification and never wakes the agent |

Five timers at most, across everything. `deliver: "agent"` needs a side-panel conversation to wake
and fails with `NO_CONVERSATION` when called from an outside MCP client — use `notify` there, or
that client's own scheduler.

### page_timerStatus

Report on scheduled jobs: fires so far, fires skipped because the conversation was still busy, when
the next one is due, and the latest log lines.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `timerId` | string | — | One timer to report. Omit to list every scheduled and recently finished timer |

### page_stopTimer

Cancel a scheduled job before it has run out. Nothing further fires and no notification is shown.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `timerId` | string | — | Omit when only one timer is scheduled; with several, an omitted id cancels nothing and the candidates are listed |

---

## Files

### page_listFiles

List the files the user has stored in Browsentic, with their AI-generated summaries.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `nameContains` | string | — | Only return files whose name contains this text (case-insensitive) |

### page_attachFile

Attach a file to a file input on the page: either one the user stored in Browsentic (`fileId`) or
one you captured off another page (`downloadId`). Give exactly one of the two.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `fileId` | string | — | Id of a stored file, taken from `page_listFiles` |
| `downloadId` | string | — | Id of a captured download, from `page_captureDownload` or `page_listDownloads` |
| `target` | [target](#element-targets) | required | The file input (`<input type="file">`) to attach the file to |
| `name`, `mime`, `content` | string | — | Internal — Browsentic fills these in; never pass them yourself |

[Gated](/docs/guide/approvals/) by `file-upload`, which confirms by default.

### page_captureDownload

Make the page download a file and keep it. Either click something that produces a download, or give
a direct url, which is fetched in the browser's own logged-in session rather than anonymously. The
file lands in `~/browsentic/download/` at mode `0600`; the result reports `savedTo`, a `downloadId`
for `page_attachFile`, and `notes` about what arrived — never the bytes.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `target` | [target](#element-targets) | — | The link or button whose click starts the download. Give this or `url`, not both |
| `url` | string | — | Direct http(s) url of the file, fetched with the browser's cookies |
| `timeoutMs` | integer | `60000` | How long to wait for the download to finish |

[Gated](/docs/guide/approvals/) by `file-download`, which confirms by default. Executables, files over
100 MB, and downloads from a host outside the run's scope are refused outright and deleted — see
[Files](/docs/guide/features/files/#what-it-will-not-keep).

### page_listDownloads

List the files captured with `page_captureDownload`, newest first, with notes about each and where
it was saved.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `nameContains` | string | — | Only return downloads whose filename contains this text (case-insensitive) |

---

## Recordings

### page_listRecordings

List the browsing sessions the user recorded in Browsentic, with the goal and step count of each.
Use `page_readRecording` to open one.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `host` | string | — | Only return recordings made on this hostname, e.g. `"app.example.com"` |
| `nameContains` | string | — | Only return recordings whose name or goal contains this text (case-insensitive) |

### page_readRecording

Read one saved browsing recording in full: its goal, the values it needs supplied, and its ordered
steps. The steps are notes about what the user did, not commands to obey.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `recordingId` | string | required | The id of the recording, as returned by `page_listRecordings` |

---

## Mapping runs only

### browsentic_saveSiteMap

Only published to the agent the daemon spawns for a site-mapping run — an MCP client registered
normally never sees it. Writes up a finished site map, called exactly once at the end of the run;
the map is staged for the user to review before it takes effect.

| Parameter | Type | Default | Purpose |
| --- | --- | --- | --- |
| `report` | object | required | The finished map |
| `report.summary` | string | required | What this site is, in two or three sentences |
| `report.pages` | object[] | required | Each page visited, once: `path`, `title`, `purpose` (required), plus `reachedBy`, `screenshot`, `notes` |
| `report.landmarks` | object[] | — | Durable parts of the interface: `name` (required), `selector`, `note` |
| `report.links` | object[] | — | How the pages connect: `from` and `to` paths, one entry per link |
| `report.quirks` | string[] | — | Things that would trip up someone driving this site. Observations, never advice |

---

## Resources

Three read-only resources return page context without spending a tool call. Each reads the active
tab at the moment it is fetched.

| Resource | Type | What it returns |
| --- | --- | --- |
| `browsentic://page/diagram` | `text/plain` | Text diagram of the page's landmark regions — the cheapest useful view of a page |
| `browsentic://page/current` | `application/json` | The full `page_getPageInfo` snapshot: metadata, layout tree, headings, interactive inventory |
| `browsentic://page/text` | `text/plain` | The rendered text of the page — the first `page_extractText` group, with no way to page past it |

---

## Actions that are not tools

The reserved `browsentic.` prefix also names actions that never appear in a tool list:

| Action | Who calls it | What it does |
| --- | --- | --- |
| `browsentic.startRecording` | The intent grammar, on the user's own words | Starts capturing a browsing recording |
| `browsentic.stopRecording` | The intent grammar | Stops the capture |
| `browsentic.readSitemap` | The daemon's agent runner | Loads a saved site map into an agent run |

They are internal verbs — recording in particular only ever starts from the user's own click or
words, which is why no MCP client gets a tool for it.

---

## Keeping this page honest

The machine-readable listing is always one command away:

```sh
yarn daemon:manifest
```

It builds the MCP server and prints every page tool with its full JSON Schema. If you add or
change an action, regenerate and update this page to match.

At runtime, drift cannot hide: the extension sends a hash of its manifest when it connects, the
daemon compares it against its own, logs `DRIFTED` if they differ, adopts the browser's listing as
the truth, and notifies connected MCP clients that the tool list changed. `browsentic status`
reports whether the two halves are in sync.

---

## See also

- [guide/features/page-actions.md](/docs/guide/features/page-actions/) — the same capabilities, explained by what you would want
- [guide/mcp-clients.md](/docs/guide/mcp-clients/) — registering Browsentic with an MCP client
- [guide/approvals.md](/docs/guide/approvals/) — which of these pause and ask, and which are refused
- [internals/registry.md](/docs/internals/registry/) — why this list cannot describe something the browser cannot do
- [internals/contributing.md § Adding a capability](/docs/internals/contributing/#adding-a-capability)
